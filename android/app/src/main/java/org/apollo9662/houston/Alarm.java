package org.apollo9662.houston;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;

/**
 * הצלצול עצמו. מתנגן בערוץ של שעון מעורר, ולכן נשמע גם כשהטלפון במצב שקט או רטט.
 * מסך מלא מעל מסך נעול מגיע דרך התראה עם "כוונת מסך מלא".
 */
final class Alarm {
    private Alarm() {}

    static final String CH_ALARM = "alarm";
    static final String CH_STATUS = "status";
    static final String CH_MSG = "messages";
    static final String CH_WARN = "warnings";
    static final int NOTIF_ALARM = 2;
    static final int NOTIF_MSG = 3;
    static final int NOTIF_WARN = 4;
    static final long MAX_RING_MS = 120_000;
    static final String DEFAULT_REASON = "לפיט, עכשיו!";

    private static MediaPlayer player;
    private static ToneGenerator tone;
    private static Vibrator vibrator;
    private static int savedVolume = -1;
    private static Context appContext;
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final Runnable autoStop = Alarm::stopSound;

    static volatile boolean ringing = false;
    static volatile String reason = "";
    static volatile boolean test = false;

    private static final AudioAttributes ALARM_ATTRS = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();

    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel a = new NotificationChannel(CH_ALARM, "קריאה לפיט", NotificationManager.IMPORTANCE_HIGH);
        a.setDescription("כשקוראים לך לפיט");
        a.setSound(null, null); // הצליל מתנגן בנפרד, בערוץ של שעון מעורר
        a.enableVibration(false);
        a.setBypassDnd(true);
        a.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(a);
        NotificationChannel s = new NotificationChannel(CH_STATUS, "חיבור לפיט", NotificationManager.IMPORTANCE_LOW);
        s.setDescription("מראה שיוסטון מחובר ומקשיב לקריאות");
        s.setShowBadge(false);
        nm.createNotificationChannel(s);
        NotificationChannel m = new NotificationChannel(CH_MSG, "הודעות מהפיט", NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(m);
        NotificationChannel w = new NotificationChannel(CH_WARN, "אזהרות חיבור", NotificationManager.IMPORTANCE_HIGH);
        w.setDescription("כשהטלפון לא מחובר לפיט וקריאות לא יגיעו");
        nm.createNotificationChannel(w);
    }

    /** מתחיל לצלצל. test = בדיקת צלצול: נעצרת לבד אחרי כמה שניות ולא שולחת "קיבלתי". */
    static synchronized void start(Context ctx, String why, boolean isTest) {
        if (isTest && ringing && !test) return; // בדיקה לא דורסת קריאה אמיתית
        Context c = ctx.getApplicationContext();
        appContext = c;
        channels(c);
        reason = why == null ? "" : why;
        test = isTest;
        ringing = true;
        // קריאה חוזרת אחרי שהצלצול נעצר מצלצלת שוב (גם אם המסך האדום עוד פתוח)
        if (player == null && tone == null) startSound(c);
        main.removeCallbacks(autoStop);
        main.postDelayed(autoStop, isTest ? 5000 : MAX_RING_MS);

        Intent full = new Intent(c, AlarmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent fullPi = PendingIntent.getActivity(c, 1, full, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent ackPi = PendingIntent.getBroadcast(c, 2, new Intent(c, AckReceiver.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, CH_ALARM)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("יוסטון, יש לנו בעיה")
                .setContentText(reason.isEmpty() ? DEFAULT_REASON : reason)
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(fullPi, true)
                .setContentIntent(fullPi)
                .addAction(new Notification.Action.Builder(null, "קיבלתי, בדרך!", ackPi).build())
                .build();
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        nm.cancel(NOTIF_ALARM); // כדי שהמסך המלא וההתראה הקופצת יופיעו שוב
        nm.notify(NOTIF_ALARM, n);

        // אם האפליקציה פתוחה מולך, פותחים את המסך האדום מיד
        if (MainActivity.visible || AlarmActivity.isOpen()) {
            try { c.startActivity(full); } catch (Exception ignored) {}
        }
    }

    private static void startSound(Context c) {
        AudioManager am = c.getSystemService(AudioManager.class);
        try {
            int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            int cur = am.getStreamVolume(AudioManager.STREAM_ALARM);
            int want = Math.max(1, (int) Math.ceil(max * 0.85));
            if (cur < want) { savedVolume = cur; am.setStreamVolume(AudioManager.STREAM_ALARM, want, 0); }
        } catch (Exception ignored) {}

        // צליל שעון מעורר, ואם אין: צלצול, ואם אין: צליל התראה, ואם אין: צפצוף מובנה
        int[] types = { RingtoneManager.TYPE_ALARM, RingtoneManager.TYPE_RINGTONE, RingtoneManager.TYPE_NOTIFICATION };
        for (int type : types) {
            Uri uri = RingtoneManager.getDefaultUri(type);
            if (uri == null) continue;
            MediaPlayer p = new MediaPlayer();
            try {
                p.setAudioAttributes(ALARM_ATTRS);
                // אם הנגן נתקע באמצע, עוברים לצפצוף המובנה
                p.setOnErrorListener((mp, what, extra) -> { fallbackTone(mp); return true; });
                p.setDataSource(c, uri);
                p.setLooping(true);
                p.prepare();
                p.start();
                player = p;
                break;
            } catch (Exception e) {
                try { p.release(); } catch (Exception ignored) {}
                player = null;
            }
        }
        if (player == null) startTone();

        vibrator = c.getSystemService(Vibrator.class);
        if (vibrator != null && vibrator.hasVibrator()) {
            long[] pattern = { 0, 700, 300, 700, 300, 700, 1000 };
            // עם סימון "שעון מעורר", כדי שהרטט לא יושתק במצב שקט
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), ALARM_ATTRS);
        }
    }

    private static void startTone() {
        try {
            tone = new ToneGenerator(AudioManager.STREAM_ALARM, ToneGenerator.MAX_VOLUME);
            tone.startTone(ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK);
        } catch (Exception e) {
            tone = null;
        }
    }

    private static synchronized void fallbackTone(MediaPlayer mp) {
        if (mp != player) return;
        try { mp.release(); } catch (Exception ignored) {}
        player = null;
        if (ringing && tone == null) startTone();
    }

    /** עוצר את הצליל והרטט. המסך האדום וההתראה נשארים עד "קיבלתי" או עד ביטול מהפיט. */
    static synchronized void stopSound() {
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) {}
            player.release();
            player = null;
        }
        if (tone != null) {
            try { tone.stopTone(); tone.release(); } catch (Exception ignored) {}
            tone = null;
        }
        if (vibrator != null) { vibrator.cancel(); vibrator = null; }
        if (savedVolume >= 0 && appContext != null) {
            try { appContext.getSystemService(AudioManager.class).setStreamVolume(AudioManager.STREAM_ALARM, savedVolume, 0); } catch (Exception ignored) {}
            savedVolume = -1;
        }
        if (test) stop(appContext);
    }

    /** עוצר הכול: צליל, רטט, התראה, ומסך אדום. */
    static synchronized void stop(Context ctx) {
        main.removeCallbacks(autoStop);
        boolean was = ringing;
        ringing = false;
        test = false;
        if (player != null || tone != null || vibrator != null) stopSound();
        if (ctx != null) ctx.getApplicationContext().getSystemService(NotificationManager.class).cancel(NOTIF_ALARM);
        if (was) AlarmActivity.closeIfOpen();
    }

    /** כפתור "קיבלתי, בדרך!" – מהמסך האדום או מההתראה. */
    static void ack(Context ctx) {
        boolean wasTest = test;
        stop(ctx);
        if (!wasTest) Prefs.ack(ctx);
    }
}

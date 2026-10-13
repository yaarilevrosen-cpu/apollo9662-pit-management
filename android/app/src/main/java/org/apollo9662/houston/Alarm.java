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
import android.net.Uri;
import android.os.Build;
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
    static final int NOTIF_ALARM = 2;
    static final int NOTIF_MSG = 3;
    static final long MAX_RING_MS = 120_000;

    private static MediaPlayer player;
    private static Vibrator vibrator;
    private static int savedVolume = -1;
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final Runnable autoStop = () -> stopSound();

    static volatile boolean ringing = false;
    static volatile String reason = "";
    static volatile boolean test = false;

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
    }

    /** מתחיל לצלצל. test = בדיקת צלצול: נעצר לבד אחרי כמה שניות ולא שולח "קיבלתי". */
    static synchronized void start(Context ctx, String why, boolean isTest) {
        Context c = ctx.getApplicationContext();
        channels(c);
        reason = why == null ? "" : why;
        test = isTest;
        if (!ringing) {
            ringing = true;
            startSound(c);
        }
        main.removeCallbacks(autoStop);
        main.postDelayed(autoStop, isTest ? 5000 : MAX_RING_MS);

        Intent full = new Intent(c, AlarmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent fullPi = PendingIntent.getActivity(c, 1, full, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent ackPi = PendingIntent.getBroadcast(c, 2, new Intent(c, AckReceiver.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, CH_ALARM)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("יוסטון, יש לנו בעיה")
                .setContentText(reason.isEmpty() ? "בוא לפיט עכשיו!" : reason)
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(fullPi, true)
                .setContentIntent(fullPi)
                .addAction(new Notification.Action.Builder(null, "קיבלתי, בדרך!", ackPi).build())
                .build();
        c.getSystemService(NotificationManager.class).notify(NOTIF_ALARM, n);

        // אם האפליקציה פתוחה מולך, פותחים את המסך האדום מיד
        if (MainActivity.visible) {
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

        Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setDataSource(c, uri);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            player = null;
        }

        vibrator = c.getSystemService(Vibrator.class);
        if (vibrator != null && vibrator.hasVibrator()) {
            long[] pattern = { 0, 700, 300, 700, 300, 700, 1000 };
            if (Build.VERSION.SDK_INT >= 33) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0),
                        new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
            } else {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            }
        }
        appContext = c;
    }

    private static Context appContext;

    /** עוצר את הצליל והרטט. המסך האדום וההתראה נשארים עד "קיבלתי" או עד ביטול מהפיט. */
    static synchronized void stopSound() {
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) {}
            player.release();
            player = null;
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
        if (player != null || vibrator != null) stopSound();
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

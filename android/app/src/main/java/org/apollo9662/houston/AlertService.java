package org.apollo9662.houston;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * שירות רקע שמחובר כל הזמן למחשב בפיט ומקשיב לקריאות.
 * רץ גם כשהאפליקציה סגורה והמסך כבוי, עם התראה קבועה שמראה שהוא פעיל.
 */
public class AlertService extends Service {
    static final int NOTIF_STATUS = 1;
    static final long WARN_AFTER_MS = 120_000; // אחרי שתי דקות בלי חיבור: התראה בולטת
    static volatile boolean connected = false;

    private volatile boolean running = false;
    private volatile Thread worker;
    private volatile HttpURLConnection conn;
    private volatile long downSince = 0;
    private volatile boolean warned = false;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    static void startIfReady(Context c) {
        if (Prefs.base(c).isEmpty() || Prefs.token(c).isEmpty()) return;
        try { c.startForegroundService(new Intent(c, AlertService.class)); } catch (Exception ignored) {}
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, AlertService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Alarm.channels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = status(connected);
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIF_STATUS, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
            else startForeground(NOTIF_STATUS, n);
        } catch (Exception e) {
            // אנדרואיד לא נתן להפעיל ברקע (למשל אחרי שהמערכת סגרה את השירות)
            Warn.show(this, Warn.OUT, "יוסטון לא מקשיב לקריאות", "פותחים את יוסטון כדי להתחבר לפיט מחדש.");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!running) {
            running = true;
            PowerManager pm = getSystemService(PowerManager.class);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "houston:listen");
            wake.setReferenceCounted(false);
            WifiManager wm = getApplicationContext().getSystemService(WifiManager.class);
            if (wm != null) {
                wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "houston:wifi");
                wifi.setReferenceCounted(false);
                wifi.acquire();
            }
            // כשהרשת משתנה, מתחברים מחדש מיד במקום לחכות שהחיבור הישן ייפול
            Net.watch(this, this::kick);
            worker = new Thread(this::loop, "houston-stream");
            worker.start();
        } else if (!connected) {
            kick(); // רק אם עוד לא מחוברים: לא מפילים חיבור תקין בכל פתיחה של האפליקציה
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        Net.forget(this);
        connected = false;
        HttpURLConnection h = conn;
        if (h != null) h.disconnect();
        Thread w = worker;
        if (w != null) w.interrupt();
        if (wake != null && wake.isHeld()) wake.release();
        if (wifi != null && wifi.isHeld()) wifi.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent i) { return null; }

    /** מנתק את החיבור הנוכחי ומתחבר שוב מיד. */
    private void kick() {
        HttpURLConnection h = conn;
        if (h != null) h.disconnect();
        Thread w = worker;
        if (w != null && !connected) w.interrupt();
    }

    // ---------- החיבור לפיט ----------
    private void loop() {
        long backoff = 1000;
        int fails = 0;
        while (running) {
            // נעילה עם זמן קצוב שמתחדשת בכל סבב, כדי שלא תיתקע לעולם
            try { wake.acquire(30 * 60_000L); } catch (Throwable ignored) {}
            String base = Prefs.base(this), token = Prefs.token(this);
            if (base.isEmpty() || token.isEmpty()) { stopSelf(); return; }
            try {
                URL u = new URL(base + "/api/stream?token=" + URLEncoder.encode(token, "UTF-8"));
                // אחרי שני כישלונות דרך הרשת האלחוטית, מנסים פעם אחת בדרך הרגילה
                boolean viaWifi = fails < 2 || fails % 2 == 1;
                HttpURLConnection h = (HttpURLConnection) Net.open(u, viaWifi);
                conn = h;
                h.setConnectTimeout(8000);
                h.setReadTimeout(30000); // השרת שולח סימן חיים כל 20 שניות
                h.setRequestProperty("accept", "text/event-stream");
                int code = h.getResponseCode();
                if (code == 401) { signedOut(); return; }
                if (code != 200) throw new Exception("http " + code);
                // דף של רשת אורחים או של מנהרה עונה 200 בלי זרם אירועים: זה לא חיבור
                String type = h.getContentType();
                if (type == null || !type.startsWith("text/event-stream")) throw new Exception("not a stream");
                final long since = System.currentTimeMillis();
                final boolean[] first = { true };
                BufferedReader r = new BufferedReader(new InputStreamReader(h.getInputStream(), StandardCharsets.UTF_8));
                SseReader.read(r, () -> running, this::dispatch, () -> {
                    // כל שורה מהשרת (גם סימן החיים כל 20 שניות) מחדשת את נעילת המעבד
                    try { wake.acquire(30 * 60_000L); } catch (Throwable ignored) {}
                    if (first[0]) {
                        first[0] = false;
                        if (running) setConnected(true);
                        if (Prefs.pendingAck(this)) Prefs.ack(this); // "קיבלתי" שלא הגיע קודם
                    }
                });
                if (System.currentTimeMillis() - since > 30_000) { backoff = 1000; fails = 0; }
            } catch (Throwable ignored) {
            } finally {
                HttpURLConnection h = conn;
                if (h != null) h.disconnect();
            }
            if (!running) return;
            fails++;
            setConnected(false);
            try { Thread.sleep(backoff); } catch (InterruptedException e) { if (!running) return; }
            backoff = Math.min(backoff * 2, 10000);
        }
    }

    private void dispatch(String event, String data) {
        try {
            JSONObject d;
            try { d = new JSONObject(data.isEmpty() ? "{}" : data); } catch (Exception e) { d = new JSONObject(); }
            switch (event) {
                case "alert":
                    Alarm.start(this, d.optString("reason", ""), false);
                    break;
                case "alert-stop":
                    Alarm.stop(this);
                    break;
                case "message":
                    if (!MainActivity.visible && d.has("text")) message(d.optString("from", "הפיט"), d.optString("text", ""));
                    break;
                case "kicked":
                    signedOut();
                    break;
                default:
                    break;
            }
        } catch (Throwable ignored) {
            // תקלה בטיפול באירוע אחד לא מפילה את החיבור
        }
    }

    private void signedOut() {
        Prefs.setToken(this, "");
        Alarm.stop(this);
        running = false;
        Warn.show(this, Warn.OUT, "נותקת מהפיט", "קריאות לא יגיעו לטלפון הזה. פותחים את יוסטון ומתחברים שוב.");
        stopSelf();
    }

    private void setConnected(boolean on) {
        if (on) {
            downSince = 0;
            if (warned) { Warn.clear(this, Warn.OFF); warned = false; }
            Warn.clear(this, Warn.OUT);
        } else if (downSince == 0) {
            downSince = System.currentTimeMillis();
        } else if (!warned && System.currentTimeMillis() - downSince > WARN_AFTER_MS) {
            warned = true;
            Warn.show(this, Warn.OFF, "אין חיבור לפיט", "כבר שתי דקות שהטלפון לא מחובר למחשב בפיט, וקריאות לא יגיעו. בודקים שהטלפון באותה רשת.");
        }
        if (connected == on || !running) return;
        connected = on;
        getSystemService(NotificationManager.class).notify(NOTIF_STATUS, status(on));
    }

    private Notification status(boolean on) {
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, Alarm.CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(on ? "יוסטון מחובר לפיט" : "יוסטון מנסה להתחבר לפיט")
                .setContentText(on ? "קריאות יצלצלו גם במצב שקט" : "בודק שוב בעוד כמה שניות")
                .setOngoing(true)
                .setContentIntent(open)
                .build();
    }

    private void message(String from, String text) {
        PendingIntent open = PendingIntent.getActivity(this, 3,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, Alarm.CH_MSG)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("הודעה מ" + from)
                .setContentText(text)
                .setAutoCancel(true)
                .setContentIntent(open)
                .build();
        getSystemService(NotificationManager.class).notify(Alarm.NOTIF_MSG, n);
    }
}

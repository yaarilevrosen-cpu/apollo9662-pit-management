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
    static volatile boolean connected = false;

    private volatile boolean running = false;
    private Thread worker;
    private HttpURLConnection conn;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    static void startIfReady(Context c) {
        if (Prefs.base(c).isEmpty() || Prefs.token(c).isEmpty()) return;
        c.startForegroundService(new Intent(c, AlertService.class));
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
        Notification n = status(false);
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_STATUS, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        } else {
            startForeground(NOTIF_STATUS, n);
        }
        if (!running) {
            running = true;
            PowerManager pm = getSystemService(PowerManager.class);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "houston:listen");
            wake.acquire();
            WifiManager wm = getApplicationContext().getSystemService(WifiManager.class);
            if (wm != null) {
                wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "houston:wifi");
                wifi.acquire();
            }
            worker = new Thread(this::loop, "houston-stream");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        connected = false;
        if (conn != null) conn.disconnect();
        if (worker != null) worker.interrupt();
        if (wake != null && wake.isHeld()) wake.release();
        if (wifi != null && wifi.isHeld()) wifi.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent i) { return null; }

    // ---------- החיבור לפיט ----------
    private void loop() {
        long backoff = 2000;
        while (running) {
            String base = Prefs.base(this), token = Prefs.token(this);
            if (base.isEmpty() || token.isEmpty()) { stopSelf(); return; }
            try {
                URL u = new URL(base + "/api/stream?token=" + URLEncoder.encode(token, "UTF-8"));
                conn = (HttpURLConnection) u.openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(45000); // השרת שולח סימן חיים כל 20 שניות
                conn.setRequestProperty("accept", "text/event-stream");
                int code = conn.getResponseCode();
                if (code == 401 || code == 403) { signedOut(); return; }
                if (code != 200) throw new Exception("http " + code);
                setConnected(true);
                backoff = 2000;
                BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
                SseReader.read(r, () -> running, this::dispatch);
            } catch (Exception ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }
            setConnected(false);
            if (!running) return;
            try { Thread.sleep(backoff); } catch (InterruptedException e) { return; }
            backoff = Math.min(backoff * 2, 15000);
        }
    }

    private void dispatch(String event, String data) {
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
    }

    private void signedOut() {
        Prefs.setToken(this, "");
        Alarm.stop(this);
        running = false;
        stopSelf();
    }

    private void setConnected(boolean on) {
        if (connected == on) return;
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

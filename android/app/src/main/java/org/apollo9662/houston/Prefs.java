package org.apollo9662.houston;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** הגדרות שנשמרות בטלפון: כתובת השרת בפיט, ואסימון ההתחברות. */
final class Prefs {
    private Prefs() {}

    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences("houston", Context.MODE_PRIVATE);
    }

    /** הכתובת השמורה, תמיד בצורה אחידה (גם כתובת שנשמרה בגרסה קודמת). */
    static String base(Context c) {
        String b = sp(c).getString("base", "");
        if (b.isEmpty()) return b;
        String[] p = parse(b);
        return p == null ? b : p[0];
    }
    static boolean pendingAck(Context c) { return sp(c).getBoolean("pendingAck", false); }
    static void setPendingAck(Context c, boolean on) { sp(c).edit().putBoolean("pendingAck", on).apply(); }
    static String token(Context c) { return sp(c).getString("token", ""); }

    static void setBase(Context c, String base) { sp(c).edit().putString("base", base).apply(); }
    static void setToken(Context c, String token) { sp(c).edit().putString("token", token == null ? "" : token).apply(); }

    /**
     * מקבל מה שהמשתמש הקליד או סרק: "192.168.1.20:8765", או כתובת מלאה עם קוד הצטרפות.
     * מחזיר [כתובת בסיס, קוד הצטרפות או ריק], או null אם זה לא נראה כמו כתובת.
     */
    static String[] parse(String input) {
        String s = input == null ? "" : input.trim();
        if (s.isEmpty()) return null;
        if (!s.startsWith("http://") && !s.startsWith("https://")) {
            // כתובת מקומית (מספרים או .local) בלי הצפנה. שם של אתר, למשל מנהרה, תמיד מוצפן.
            String host = s.split("[/:?]")[0];
            s = (Net.isPrivate(host) || host.matches("[0-9.]+") || host.equals("localhost") ? "http://" : "https://") + s;
        }
        Uri u = Uri.parse(s);
        if (u.getHost() == null || u.getHost().isEmpty()) return null;
        String scheme = u.getScheme().toLowerCase(java.util.Locale.ROOT);
        int port = u.getPort();
        // כמו שהדפדפן כותב את הכתובת: אותיות קטנות, ובלי פורט ברירת המחדל
        if ((port == 80 && scheme.equals("http")) || (port == 443 && scheme.equals("https"))) port = -1;
        String base = scheme + "://" + u.getHost().toLowerCase(java.util.Locale.ROOT) + (port > 0 ? ":" + port : "");
        String code = u.getQueryParameter("code");
        return new String[] { base, code == null ? "" : code };
    }

    /** "קיבלתי, בדרך!" – נשלח לשרת ברקע, עם ניסיונות חוזרים עד שהפיט מאשר. */
    static void ack(Context c) {
        final Context app = c.getApplicationContext();
        final String base = base(app), token = token(app);
        if (base.isEmpty() || token.isEmpty()) return;
        setPendingAck(app, true);
        new Thread(() -> {
            long wait = 1000;
            for (int i = 0; i < 6; i++) {
                try {
                    HttpURLConnection h = (HttpURLConnection) Net.open(new URL(base + "/api/ack"));
                    h.setConnectTimeout(6000);
                    h.setReadTimeout(6000);
                    h.setRequestMethod("POST");
                    h.setDoOutput(true);
                    h.setRequestProperty("content-type", "application/json");
                    h.setRequestProperty("x-token", token);
                    try (OutputStream o = h.getOutputStream()) { o.write("{}".getBytes(StandardCharsets.UTF_8)); }
                    int code = h.getResponseCode();
                    h.disconnect();
                    if (code >= 200 && code < 300) { setPendingAck(app, false); Warn.clear(app, Warn.ACK); return; }
                    if (code == 401) { setPendingAck(app, false); break; }
                } catch (Exception ignored) {
                }
                try { Thread.sleep(wait); } catch (InterruptedException e) { return; }
                wait = Math.min(wait * 2, 8000);
            }
            // ננסה שוב לבד ברגע שהחיבור לפיט יחזור
            Warn.show(app, Warn.ACK, "\"קיבלתי\" לא הגיע לפיט", "אין חיבור לפיט. הולכים לפיט, או פותחים את יוסטון ולוחצים שוב.");
        }).start();
    }
}

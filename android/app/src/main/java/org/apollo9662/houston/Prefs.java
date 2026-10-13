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

    static String base(Context c) { return sp(c).getString("base", ""); }
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
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
        Uri u = Uri.parse(s);
        if (u.getHost() == null || u.getHost().isEmpty()) return null;
        String base = u.getScheme() + "://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
        String code = u.getQueryParameter("code");
        return new String[] { base, code == null ? "" : code };
    }

    /** "קיבלתי, בדרך!" – נשלח לשרת ברקע. */
    static void ack(Context c) {
        final String base = base(c), token = token(c);
        if (base.isEmpty() || token.isEmpty()) return;
        new Thread(() -> {
            try {
                HttpURLConnection h = (HttpURLConnection) new URL(base + "/api/ack").openConnection();
                h.setConnectTimeout(6000);
                h.setReadTimeout(6000);
                h.setRequestMethod("POST");
                h.setDoOutput(true);
                h.setRequestProperty("content-type", "application/json");
                h.setRequestProperty("x-token", token);
                try (OutputStream o = h.getOutputStream()) { o.write("{}".getBytes(StandardCharsets.UTF_8)); }
                h.getResponseCode();
                h.disconnect();
            } catch (Exception ignored) {
            }
        }).start();
    }
}

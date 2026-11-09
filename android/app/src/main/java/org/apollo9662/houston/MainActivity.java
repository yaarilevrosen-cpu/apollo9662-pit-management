package org.apollo9662.houston;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * המסך הראשי: אותו דף טלפון כמו בדפדפן, בתוך האפליקציה.
 * ההבדל: הקריאות מגיעות לשירות הרקע, שמצלצל גם במצב שקט ומעל מסך נעול.
 */
public class MainActivity extends Activity {
    static volatile boolean visible = false;

    private static final int BG = Color.rgb(0x16, 0x1B, 0x19);
    private static final int ACCENT = Color.rgb(0xF2, 0xA9, 0x00);

    private WebView web;
    /** הכתובת של הדף שפתוח עכשיו. הגישה לאפליקציה מותרת רק לדפים מהמחשב בפיט. */
    private volatile String pageOrigin = "";

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        Alarm.channels(this);
        Net.watch(this, null);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        }
        if (Prefs.base(this).isEmpty()) showSetup(null);
        else openApp(null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        if (web != null) web.onResume();
        // קריאה שמצלצלת עכשיו: המסך האדום תמיד זמין, גם אם ההתראות כבויות
        if (Alarm.ringing) {
            try { startActivity(new Intent(this, AlarmActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)); } catch (Exception ignored) {}
        }
    }

    @Override
    protected void onPause() {
        visible = false;
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    // ---------- מסך כתובת השרת ----------
    private void showSetup(String error) {
        if (web != null) { web.destroy(); web = null; }
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setBackgroundColor(BG);
        int p = dp(24);
        root.setPadding(p, dp(56), p, p);

        TextView title = label("יוסטון", 34, Color.WHITE, true);
        TextView sub = label("מרכז הבקרה של הפיט, אפולו 9662", 16, Color.rgb(0x9A, 0xA6, 0x9F), false);
        TextView help = label("הכתובת מופיעה במסך הפיט, בחלון \"חיבור טלפונים והגדרות\". למשל:\n192.168.1.20:8765", 16, Color.rgb(0xE8, 0xEE, 0xE4), false);

        EditText addr = new EditText(this);
        addr.setHint("כתובת המחשב בפיט");
        addr.setText(Prefs.base(this).replace("http://", ""));
        addr.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        addr.setTextDirection(View.TEXT_DIRECTION_LTR);
        addr.setTextColor(Color.WHITE);
        addr.setHintTextColor(Color.rgb(0x6F, 0x7B, 0x75));
        addr.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);

        TextView err = label(error == null ? "" : error, 15, Color.rgb(0xFF, 0x8A, 0x8A), false);

        Button go = new Button(this);
        go.setText("התחברות");
        go.setAllCaps(false);
        go.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        go.setTypeface(Typeface.DEFAULT_BOLD);
        go.setTextColor(Color.rgb(0x24, 0x1A, 0x00));
        go.setBackgroundColor(ACCENT);
        go.setOnClickListener(v -> {
            String[] parsed = Prefs.parse(addr.getText().toString());
            if (parsed == null) { err.setText("זו לא נראית כמו כתובת"); return; }
            if (!parsed[0].equals(Prefs.base(this))) {
                // שרת אחר: האסימון הישן לא שייך אליו
                Prefs.setToken(this, "");
                AlertService.stop(this);
            }
            Prefs.setBase(this, parsed[0]);
            Net.bind(this);
            openApp(parsed[1]);
        });

        root.addView(title);
        root.addView(sub);
        root.addView(space(28));
        root.addView(help);
        root.addView(space(12));
        root.addView(addr);
        root.addView(err);
        root.addView(space(12));
        root.addView(go);
        setContentView(root);
    }

    // ---------- דף הטלפון ----------
    @SuppressLint({ "SetJavaScriptEnabled", "JavascriptInterface" })
    private void openApp(String code) {
        final String base = Prefs.base(this);
        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Bridge(), "HoustonAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) { pageOrigin = originOf(Uri.parse(url)); }

            @Override
            public void doUpdateVisitedHistory(WebView v, String url, boolean reload) { pageOrigin = originOf(Uri.parse(url)); }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                // מסגרת מאתר אחר לא נטענת בתוך האפליקציה
                if (!r.isForMainFrame() && "document".equals(r.getRequestHeaders().get("Sec-Fetch-Dest"))
                        && !base.equals(originOf(r.getUrl()))) {
                    return new android.webkit.WebResourceResponse("text/plain", "utf-8", 403, "blocked", null, null);
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (originOf(u).equals(base)) return false;
                // קישור חיצוני נפתח בדפדפן, לא בתוך האפליקציה
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) showSetup("אין חיבור למחשב בפיט בכתובת הזו. בודקים שהטלפון באותה רשת, ושהשרת פועל.");
            }
        });
        setContentView(web);
        String url = base + "/m" + (code != null && !code.isEmpty() ? "?code=" + Uri.encode(code) : "");
        web.loadUrl(url);
        AlertService.startIfReady(this);
    }

    static String originOf(Uri u) {
        if (u == null || u.getScheme() == null || u.getHost() == null) return "";
        String scheme = u.getScheme().toLowerCase(java.util.Locale.ROOT);
        int port = u.getPort();
        if ((port == 80 && scheme.equals("http")) || (port == 443 && scheme.equals("https"))) port = -1;
        return scheme + "://" + u.getHost().toLowerCase(java.util.Locale.ROOT) + (port > 0 ? ":" + port : "");
    }

    /** הדף שמבקש הוא באמת מהמחשב בפיט? */
    private boolean trusted() {
        String b = Prefs.base(this);
        return !b.isEmpty() && originOf(Uri.parse(b)).equals(pageOrigin);
    }

    /** מה שדף הטלפון יכול לבקש מהאפליקציה. נגיש רק לדפים מהשרת בפיט. */
    private class Bridge {
        @JavascriptInterface
        public void setSession(String token) {
            if (!trusted() || token == null || token.isEmpty()) return;
            Prefs.setToken(MainActivity.this, token);
            AlertService.startIfReady(MainActivity.this);
        }

        @JavascriptInterface
        public void clearSession() {
            if (!trusted()) return;
            Prefs.setToken(MainActivity.this, "");
            AlertService.stop(MainActivity.this);
            Alarm.stop(MainActivity.this);
        }

        @JavascriptInterface
        public void testAlarm() {
            if (!trusted()) return;
            if (Alarm.ringing && !Alarm.test) return; // לא דורסים קריאה אמיתית
            Alarm.start(MainActivity.this, "בדיקת צלצול", true);
        }

        @JavascriptInterface
        public void changeServer() {
            if (!trusted()) return;
            runOnUiThread(() -> showSetup(null));
        }

        /** מה עוד צריך לאשר בטלפון כדי שהצלצול יגיע בכל מצב. */
        @JavascriptInterface
        public String status() {
            JSONObject o = new JSONObject();
            try {
                NotificationManager nm = getSystemService(NotificationManager.class);
                PowerManager pm = getSystemService(PowerManager.class);
                o.put("notifications", nm.areNotificationsEnabled());
                android.app.NotificationChannel ch = nm.getNotificationChannel(Alarm.CH_ALARM);
                o.put("channel", ch == null || ch.getImportance() >= NotificationManager.IMPORTANCE_HIGH);
                int f = nm.getCurrentInterruptionFilter();
                boolean silent = f == NotificationManager.INTERRUPTION_FILTER_NONE;
                try {
                    // "נא לא להפריע" עם עדיפות, כשהשעון המעורר לא ברשימת החריגים
                    if (f == NotificationManager.INTERRUPTION_FILTER_PRIORITY
                            && (nm.getNotificationPolicy().priorityCategories & NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS) == 0) silent = true;
                } catch (Exception ignored) {}
                o.put("silentAll", silent);
                o.put("fullScreen", Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent());
                o.put("battery", pm.isIgnoringBatteryOptimizations(getPackageName()));
                o.put("connected", AlertService.connected);
            } catch (Exception ignored) {}
            return o.toString();
        }

        @JavascriptInterface
        public void fix(String what) {
            if (!trusted()) return;
            runOnUiThread(() -> {
                try {
                    Intent i;
                    if ("channel".equals(what)) {
                        i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                                .putExtra(Settings.EXTRA_CHANNEL_ID, Alarm.CH_ALARM);
                    } else if ("battery".equals(what)) {
                        i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
                    } else if ("fullScreen".equals(what) && Build.VERSION.SDK_INT >= 34) {
                        i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getPackageName()));
                    } else {
                        i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    }
                    startActivity(i);
                } catch (Exception e) {
                    startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
                }
            });
        }
    }

    // ---------- עזרים ----------
    private TextView label(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(color);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setGravity(Gravity.START);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private View space(int h) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(1, dp(h)));
        return v;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}

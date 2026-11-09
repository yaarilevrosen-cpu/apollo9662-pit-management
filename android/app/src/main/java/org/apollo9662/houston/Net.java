package org.apollo9662.houston;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;

import java.io.IOException;
import java.net.InetAddress;
import java.net.URL;
import java.net.URLConnection;

/**
 * חיבור לרשת. רשת אלחוטית בלי אינטרנט (נקודה חמה בלי גלישה, רשת של אולם) גורמת לאנדרואיד
 * לשלוח הכול דרך הגלישה הסלולרית, ואז המחשב בפיט לא נמצא. כשכתובת הפיט פרטית, מחברים דרך הרשת האלחוטית.
 */
final class Net {
    private Net() {}

    private static volatile Network wifi;
    private static boolean watching = false;
    private static volatile Runnable onChange;

    /** מתחיל לעקוב אחרי הרשת האלחוטית. onChange נקרא כשהיא מופיעה או נעלמת. */
    static synchronized void watch(Context ctx, Runnable listener) {
        if (listener != null) onChange = listener;
        if (watching) { bind(ctx); return; }
        watching = true;
        final Context c = ctx.getApplicationContext();
        ConnectivityManager cm = c.getSystemService(ConnectivityManager.class);
        // הרשת האלחוטית שכבר מחוברת עכשיו, כדי שגם הטעינה הראשונה תלך דרכה
        try {
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(n);
                if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) { wifi = n; break; }
            }
            bind(c);
        } catch (Exception ignored) {}
        NetworkRequest req = new NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build();
        try {
            cm.registerNetworkCallback(req, new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network n) { wifi = n; bind(c); changed(); }
                @Override public void onLost(Network n) { if (n.equals(wifi)) { wifi = null; bind(c); } changed(); }
            });
        } catch (Exception ignored) {
            watching = false;
        }
    }

    private static void changed() {
        Runnable r = onChange;
        if (r != null) r.run();
    }

    /** כל האפליקציה (כולל דף הטלפון) הולכת דרך הרשת האלחוטית כשהפיט בכתובת פרטית. */
    static void bind(Context c) {
        try {
            ConnectivityManager cm = c.getApplicationContext().getSystemService(ConnectivityManager.class);
            String host = hostOf(Prefs.base(c));
            Network n = wifi;
            cm.bindProcessToNetwork(n != null && isPrivate(host) && reaches(cm, n, host) ? n : null);
        } catch (Exception ignored) {}
    }

    /** מפסיק להודיע לשירות שכבר נסגר. */
    static synchronized void forget(Object owner) { onChange = null; }

    static URLConnection open(URL u) throws IOException { return open(u, true); }

    static URLConnection open(URL u, boolean viaWifi) throws IOException {
        Network n = wifi;
        if (viaWifi && n != null && isPrivate(u.getHost())) return n.openConnection(u);
        return u.openConnection();
    }

    /** הכתובת של הפיט נמצאת ברשת המקומית של החיבור האלחוטי? (.local תמיד כן) */
    private static boolean reaches(ConnectivityManager cm, Network n, String host) {
        if (host.endsWith(".local")) return true;
        try {
            LinkProperties lp = cm.getLinkProperties(n);
            if (lp == null) return false;
            byte[] target = InetAddress.getByName(host).getAddress();
            for (LinkAddress la : lp.getLinkAddresses()) {
                byte[] mine = la.getAddress().getAddress();
                if (mine.length != target.length) continue;
                int bits = la.getPrefixLength(), i = 0;
                boolean same = true;
                for (; bits >= 8 && i < mine.length; bits -= 8, i++) if (mine[i] != target[i]) { same = false; break; }
                if (same && bits > 0 && i < mine.length) {
                    int mask = (0xFF << (8 - bits)) & 0xFF;
                    same = (mine[i] & mask) == (target[i] & mask);
                }
                if (same) return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    private static String hostOf(String base) {
        try { return new URL(base).getHost(); } catch (Exception e) { return ""; }
    }

    static boolean isPrivate(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(java.util.Locale.ROOT);
        if (h.endsWith(".local")) return true;
        String[] p = h.split("\\.");
        if (p.length != 4) return false;
        try {
            int a = Integer.parseInt(p[0]), b = Integer.parseInt(p[1]);
            return a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254);
        } catch (NumberFormatException e) {
            return false;
        }
    }
}

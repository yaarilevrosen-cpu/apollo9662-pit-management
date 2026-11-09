package org.apollo9662.houston;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

/** התראה בולטת כשמשהו מונע מקריאות להגיע: ניתוק מהפיט, או "קיבלתי" שלא נשלח. */
final class Warn {
    private Warn() {}

    static final int OFF = 4, ACK = 5, OUT = 6; // כל אזהרה בנפרד, כדי שאחת לא תמחק אחרת

    static void show(Context ctx, int id, String title, String text) {
        Context c = ctx.getApplicationContext();
        Alarm.channels(c);
        PendingIntent open = PendingIntent.getActivity(c, 5,
                new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, Alarm.CH_WARN)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(open)
                .build();
        c.getSystemService(NotificationManager.class).notify(id, n);
    }

    static void clear(Context c, int id) {
        c.getApplicationContext().getSystemService(NotificationManager.class).cancel(id);
    }
}

package org.apollo9662.houston;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** אחרי הפעלה מחדש של הטלפון או עדכון של יוסטון: אם היינו מחוברים לפיט, מתחברים שוב. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        String a = i.getAction();
        // אחרי הפעלה מחדש, ואחרי עדכון של האפליקציה
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) AlertService.startIfReady(c);
    }
}

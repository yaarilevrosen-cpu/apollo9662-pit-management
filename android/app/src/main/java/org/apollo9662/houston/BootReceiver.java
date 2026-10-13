package org.apollo9662.houston;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** אחרי הפעלה מחדש של הטלפון: אם היינו מחוברים לפיט, מתחברים שוב. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(i.getAction())) AlertService.startIfReady(c);
    }
}

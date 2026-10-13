package org.apollo9662.houston;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** הכפתור "קיבלתי, בדרך!" שבתוך ההתראה. */
public class AckReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        Alarm.ack(c);
    }
}

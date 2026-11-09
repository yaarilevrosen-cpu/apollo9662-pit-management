package org.apollo9662.houston;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.lang.ref.WeakReference;

/** המסך האדום. נפתח גם מעל מסך נעול ומדליק את המסך. */
public class AlarmActivity extends Activity {
    private static volatile WeakReference<AlarmActivity> current = new WeakReference<>(null);
    private TextView reasonView;

    static boolean isOpen() { return current.get() != null; }

    static void closeIfOpen() {
        AlarmActivity a = current.get();
        if (a != null) a.runOnUiThread(a::finish);
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        current = new WeakReference<>(this);
        setShowWhenLocked(true);
        setTurnScreenOn(true);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.rgb(0xE5, 0x34, 0x3F));
        int pad = dp(28);
        root.setPadding(pad, pad, pad, pad);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        TextView title = text("יוסטון, יש לנו בעיה", 24, true);
        // הסיבה היא השורה הגדולה. בלי סיבה: לפיט, עכשיו!
        reasonView = text(Alarm.DEFAULT_REASON, 54, true);

        Button ack = new Button(this);
        ack.setText("קיבלתי, בדרך!");
        ack.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        ack.setTypeface(Typeface.DEFAULT_BOLD);
        ack.setTextColor(Color.rgb(0x9E, 0x15, 0x20));
        ack.setAllCaps(false);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(18));
        ack.setBackground(bg);
        ack.setPadding(dp(32), dp(18), dp(32), dp(18));
        ack.setOnClickListener(v -> { Alarm.ack(this); finish(); });

        TextView note = text("הצלצול ייעצר לבד אחרי שתי דקות", 15, false);

        root.addView(title);
        root.addView(space(10));
        root.addView(reasonView);
        root.addView(space(36));
        root.addView(ack);
        root.addView(space(18));
        root.addView(note);
        setContentView(root);
        show();
    }

    @Override
    protected void onNewIntent(android.content.Intent i) {
        super.onNewIntent(i);
        show();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!Alarm.ringing) finish();
    }

    @Override
    protected void onDestroy() {
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // לא סוגרים בטעות. רק "קיבלתי" סוגר.
    }

    private void show() {
        String r = Alarm.reason;
        boolean plain = r == null || r.isEmpty() || r.equals("בוא לפיט עכשיו!");
        reasonView.setText(plain ? Alarm.DEFAULT_REASON : r);
    }

    private TextView text(String s, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setGravity(Gravity.CENTER);
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

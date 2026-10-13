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
    private static WeakReference<AlarmActivity> current = new WeakReference<>(null);
    private TextView reasonView;

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
        root.setBackgroundColor(Color.rgb(0xC8, 0x10, 0x2E));
        int pad = dp(28);
        root.setPadding(pad, pad, pad, pad);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        TextView title = text("יוסטון, יש לנו בעיה", 38, true);
        TextView go = text("בוא לפיט עכשיו!", 24, true);
        reasonView = text("", 22, false);
        reasonView.setAlpha(0.9f);

        Button ack = new Button(this);
        ack.setText("קיבלתי, בדרך!");
        ack.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        ack.setTypeface(Typeface.DEFAULT_BOLD);
        ack.setTextColor(Color.rgb(0x8A, 0x0A, 0x1F));
        ack.setAllCaps(false);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(18));
        ack.setBackground(bg);
        ack.setPadding(dp(32), dp(18), dp(32), dp(18));
        ack.setOnClickListener(v -> { Alarm.ack(this); finish(); });

        TextView note = text("הצלצול ייעצר לבד אחרי שתי דקות", 15, false);
        note.setAlpha(0.8f);

        root.addView(title);
        root.addView(space(14));
        root.addView(go);
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
        reasonView.setText(plain ? "" : r);
        reasonView.setVisibility(plain ? View.GONE : View.VISIBLE);
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

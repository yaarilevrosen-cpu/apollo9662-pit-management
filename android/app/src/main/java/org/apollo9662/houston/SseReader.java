package org.apollo9662.houston;

import java.io.BufferedReader;
import java.io.IOException;

/** קורא זרם אירועים מהשרת (event / data / שורה ריקה). בלי תלות באנדרואיד, כדי שאפשר לבדוק אותו לבד. */
final class SseReader {
    interface Listener { void onEvent(String event, String data); }
    interface Running { boolean get(); }

    private SseReader() {}

    static void read(BufferedReader r, Running running, Listener l) throws IOException {
        String line, event = "message";
        StringBuilder data = new StringBuilder();
        while (running.get() && (line = r.readLine()) != null) {
            if (line.isEmpty()) {
                if (data.length() > 0 || !"message".equals(event)) l.onEvent(event, data.toString());
                event = "message";
                data.setLength(0);
            } else if (line.startsWith(":")) {
                // סימן חיים מהשרת, אין מה לעשות
            } else if (line.startsWith("event:")) {
                event = line.substring(6).trim();
            } else if (line.startsWith("data:")) {
                if (data.length() > 0) data.append('\n');
                data.append(line.substring(5).trim());
            }
        }
    }
}

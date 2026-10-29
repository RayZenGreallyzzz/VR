package PLACEHOLDER_PACKAGE;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "NativeSave")
public class NativeSavePlugin extends Plugin {
    private OutputStream output;

    @PluginMethod
    public void createDocument(PluginCall call) {
        if (output != null) {
            call.reject("Previous file save still active");
            return;
        }
        String name = call.getString("name", "Phoenix_VR_Avatar.glb");
        String mime = call.getString("mime", "application/octet-stream");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "documentCreated");
    }

    @ActivityCallback
    private void documentCreated(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("SAVE_CANCELLED");
            return;
        }
        Uri uri = result.getData().getData();
        try {
            output = getContext().getContentResolver().openOutputStream(uri, "w");
            if (output == null) {
                call.reject("Unable to open selected document");
                return;
            }
            JSObject response = new JSObject();
            response.put("uri", uri.toString());
            call.resolve(response);
        } catch (Exception ex) {
            closeOutput();
            call.reject("Unable to create file: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void writeChunk(PluginCall call) {
        if (output == null) {
            call.reject("No destination selected");
            return;
        }
        try {
            String data = call.getString("base64", "");
            byte[] raw = Base64.decode(data, Base64.DEFAULT);
            output.write(raw);
            call.resolve();
        } catch (Exception ex) {
            closeOutput();
            call.reject("Write failed: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void finishDocument(PluginCall call) {
        if (output == null) {
            call.reject("No active file");
            return;
        }
        try {
            output.flush();
            output.close();
            output = null;
            call.resolve();
        } catch (Exception ex) {
            closeOutput();
            call.reject("Save failed: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void cancelDocument(PluginCall call) {
        closeOutput();
        call.resolve();
    }

    private void closeOutput() {
        if (output != null) {
            try { output.close(); } catch (IOException ignored) {}
            output = null;
        }
    }
}

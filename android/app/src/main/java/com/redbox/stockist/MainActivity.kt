package com.redbox.stockist

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.KeyEvent
import android.view.View
import android.webkit.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var cameraPhotoPath: String? = null

    // Register ActivityResultLauncher for the file chooser input
    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (filePathCallback == null) return@registerForActivityResult

        var results: Array<Uri>? = null

        // Check if response is positive and contains data or if a photo was taken
        if (result.resultCode == RESULT_OK) {
            val dataString = result.data?.dataString
            if (dataString != null) {
                results = arrayOf(Uri.parse(dataString))
            } else if (cameraPhotoPath != null) {
                // If there is no data, the image should be in the file path we set
                val file = File(cameraPhotoPath!!)
                if (file.exists()) {
                    results = arrayOf(Uri.fromFile(file))
                }
            }
        }

        filePathCallback?.onReceiveValue(results)
        filePathCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Initialize WebView programmatically
        webView = WebView(this)
        setContentView(webView)

        // Configure WebView settings
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        // Enable Cookies
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        // Surface real errors in chrome://inspect instead of only Logcat
        WebView.setWebContentsDebuggingEnabled(true)

        // Set Clients
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                // Load target domain in app; external links open in system browser
                val targetHost = Uri.parse(getString(R.string.target_url)).host
                if (Uri.parse(url).host == targetHost) {
                    return false
                }
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                startActivity(intent)
                return true
            }

            // A blank screen with no feedback is undiagnosable — render the
            // actual failure so it's visible on-device without ADB/USB debugging.
            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame != true) return
                val description = error?.description ?: "unknown error"
                val code = error?.errorCode ?: 0
                val failedUrl = request.url?.toString() ?: "?"
                view?.loadData(
                    """
                    <html><body style="font-family:sans-serif;padding:24px;background:#0b0708;color:#f0eaeb;">
                    <h3 style="color:#e87068;">Gagal memuat halaman</h3>
                    <p><b>URL:</b> $failedUrl</p>
                    <p><b>Kode error:</b> $code</p>
                    <p><b>Deskripsi:</b> $description</p>
                    <p style="color:#9a8b8d;font-size:12px;">Screenshot pesan ini dan kirim ke developer.</p>
                    </body></html>
                    """.trimIndent(),
                    "text/html",
                    "UTF-8"
                )
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: WebResourceResponse?
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request?.isForMainFrame != true) return
                val status = errorResponse?.statusCode ?: 0
                val failedUrl = request.url?.toString() ?: "?"
                view?.loadData(
                    """
                    <html><body style="font-family:sans-serif;padding:24px;background:#0b0708;color:#f0eaeb;">
                    <h3 style="color:#e87068;">Server mengembalikan error</h3>
                    <p><b>URL:</b> $failedUrl</p>
                    <p><b>Status HTTP:</b> $status</p>
                    <p style="color:#9a8b8d;font-size:12px;">Screenshot pesan ini dan kirim ke developer.</p>
                    </body></html>
                    """.trimIndent(),
                    "text/html",
                    "UTF-8"
                )
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // Uncaught JS exceptions (e.g. a hydration crash) don't trigger
            // onReceivedError — they just leave the page blank with no
            // network-level failure. Logging them here means they show up
            // in `adb logcat` / chrome://inspect even without a visible
            // on-screen error, for the cases the WebViewClient can't catch.
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                android.util.Log.e(
                    "StockistWebView",
                    "${consoleMessage?.messageLevel()}: ${consoleMessage?.message()} " +
                        "(${consoleMessage?.sourceId()}:${consoleMessage?.lineNumber()})"
                )
                return true
            }

            // Handle file upload
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback

                // Create camera intent
                val takePictureIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                if (takePictureIntent.resolveActivity(packageManager) != null) {
                    var photoFile: File? = null
                    try {
                        photoFile = createImageFile()
                        takePictureIntent.putExtra("PhotoPath", cameraPhotoPath)
                    } catch (ex: IOException) {
                        // Error occurred while creating the File
                    }

                    if (photoFile != null) {
                        val photoURI = FileProvider.getUriForFile(
                            this@MainActivity,
                            "com.redbox.stockist.fileprovider",
                            photoFile
                        )
                        takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT, photoURI)
                    } else {
                        cameraPhotoPath = null
                    }
                }

                // Create chooser intent
                val contentSelectionIntent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "image/*"
                }

                val intentArray: Array<Intent> = if (takePictureIntent.resolveActivity(packageManager) != null && cameraPhotoPath != null) {
                    arrayOf(takePictureIntent)
                } else {
                    emptyArray()
                }

                val chooserIntent = Intent(Intent.ACTION_CHOOSER).apply {
                    putExtra(Intent.EXTRA_INTENT, contentSelectionIntent)
                    putExtra(Intent.EXTRA_TITLE, "Select Action")
                    putExtra(Intent.EXTRA_INITIAL_INTENTS, intentArray)
                }

                fileChooserLauncher.launch(chooserIntent)
                return true
            }
        }

        // Load target URL
        webView.loadUrl(getString(R.string.target_url))
    }

    @Throws(IOException::class)
    private fun createImageFile(): File {
        // Create an image file name
        val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
        val imageFileName = "JPEG_" + timeStamp + "_"
        val storageDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES)
        return File.createTempFile(
            imageFileName, /* prefix */
            ".jpg", /* suffix */
            storageDir      /* directory */
        ).apply {
            cameraPhotoPath = absolutePath
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}

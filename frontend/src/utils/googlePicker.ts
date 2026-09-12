import '../types/google-picker.d';

export interface GooglePickerOptions {
  accessToken: string;
  apiKey?: string;
  appId?: string;
  title?: string;
}

export interface SelectedPickerFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
}

const GAPI_SCRIPT_URL = 'https://apis.google.com/js/api.js';

let gapiLoadingPromise: Promise<void> | null = null;

/**
 * Loads the Google API client script and initializes the Google Picker library.
 */
export function loadGooglePickerApi(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window not defined'));
  }

  if (window.google?.picker?.PickerBuilder) {
    return Promise.resolve();
  }

  if (gapiLoadingPromise) {
    return gapiLoadingPromise;
  }

  gapiLoadingPromise = new Promise((resolve, reject) => {
    // Check if gapi script is already in document
    let script = document.querySelector(`script[src="${GAPI_SCRIPT_URL}"]`) as HTMLScriptElement | null;

    const onScriptLoaded = () => {
      if (!window.gapi) {
        reject(new Error('Google API client script loaded, but window.gapi is not available'));
        return;
      }
      window.gapi.load('picker', {
        callback: () => {
          if (window.google?.picker) {
            resolve();
          } else {
            reject(new Error('Google Picker library failed to initialize'));
          }
        },
        onerror: () => {
          reject(new Error('Failed to load Google Picker module via gapi.load'));
        },
      });
    };

    if (script) {
      if (window.gapi) {
        onScriptLoaded();
      } else {
        script.addEventListener('load', onScriptLoaded);
        script.addEventListener('error', () => reject(new Error('Failed to load Google API script')));
      }
      return;
    }

    script = document.createElement('script');
    script.src = GAPI_SCRIPT_URL;
    script.type = 'text/javascript';
    script.async = true;
    script.onload = onScriptLoaded;
    script.onerror = () => reject(new Error('Failed to load Google API script from ' + GAPI_SCRIPT_URL));
    document.body.appendChild(script);
  });

  return gapiLoadingPromise;
}

/**
 * Launches the official Google Picker UI.
 * Allows user to navigate folders, search Drive, and select a video file.
 */
export async function openGoogleDrivePicker(
  options: GooglePickerOptions
): Promise<SelectedPickerFile | null> {
  await loadGooglePickerApi();

  if (!window.google?.picker) {
    throw new Error('Google Picker is not available');
  }

  return new Promise<SelectedPickerFile | null>((resolve, reject) => {
    try {
      // Configure DocsView for video files with folder navigation
      const docsView = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS);
      docsView.setIncludeFolders(true);
      docsView.setSelectFolderEnabled(false);
      // Restrict selection to video formats
      docsView.setMimeTypes(
        'video/mp4,video/webm,video/x-matroska,video/quicktime,video/avi,video/x-msvideo,video/mpeg,video/3gpp,video/ogg,video/*'
      );
      docsView.setEnableDrives(true);

      const builder = new window.google.picker.PickerBuilder();
      builder.addView(docsView);
      builder.setOAuthToken(options.accessToken);

      if (options.apiKey && options.apiKey.trim() !== '') {
        builder.setDeveloperKey(options.apiKey.trim());
      }
      if (options.appId && options.appId.trim() !== '') {
        builder.setAppId(options.appId.trim());
      }

      builder.setTitle(options.title || 'Choose a video from Google Drive');
      builder.enableFeature(window.google.picker.Feature.SUPPORT_DRIVES);

      builder.setCallback((data: any) => {
        const action = data[window.google.picker.Response.ACTION];
        if (action === window.google.picker.Action.PICKED) {
          const docs = data[window.google.picker.Response.DOCUMENTS];
          if (docs && docs.length > 0) {
            const doc = docs[0];
            const fileId = doc[window.google.picker.Document.ID];
            const fileName = doc[window.google.picker.Document.NAME];
            const mimeType = doc[window.google.picker.Document.MIME_TYPE];
            const sizeStr = doc[window.google.picker.Document.SIZE_BYTES];
            const size = sizeStr ? parseInt(sizeStr, 10) : undefined;

            resolve({
              id: fileId,
              name: fileName,
              mimeType: mimeType || 'video/mp4',
              size,
            });
            return;
          }
          resolve(null);
        } else if (action === window.google.picker.Action.CANCEL) {
          resolve(null);
        }
      });

      const picker = builder.build();
      picker.setVisible(true);
    } catch (err) {
      reject(err);
    }
  });
}

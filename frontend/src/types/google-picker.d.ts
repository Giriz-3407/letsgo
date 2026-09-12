export {};

declare global {
  interface Window {
    gapi: {
      load: (
        api: string,
        callbackOrConfig: (() => void) | { callback?: () => void; onerror?: () => void }
      ) => void;
    };
    google: {
      picker: {
        PickerBuilder: new () => {
          addView: (view: any) => any;
          addUploadView?: () => any;
          setOAuthToken: (token: string) => any;
          setDeveloperKey: (key: string) => any;
          setAppId: (appId: string) => any;
          setTitle: (title: string) => any;
          setCallback: (callback: (data: any) => void) => any;
          enableFeature: (feature: any) => any;
          setSize?: (width: number, height: number) => any;
          build: () => {
            setVisible: (visible: boolean) => void;
            dispose?: () => void;
          };
        };
        DocsView: new (viewId?: any) => {
          setIncludeFolders: (include: boolean) => any;
          setSelectFolderEnabled: (enabled: boolean) => any;
          setMimeTypes: (mimeTypes: string) => any;
          setEnableDrives: (enabled: boolean) => any;
          setMode: (mode: any) => any;
        };
        DocsViewMode: {
          LIST: any;
          GRID: any;
        };
        ViewId: {
          DOCS: any;
          DOCS_IMAGES: any;
          DOCS_VIDEOS: any;
          FOLDERS: any;
        };
        Action: {
          PICKED: string;
          CANCEL: string;
        };
        Response: {
          ACTION: string;
          DOCUMENTS: string;
          VIEW: string;
        };
        Document: {
          ID: string;
          NAME: string;
          MIME_TYPE: string;
          SIZE_BYTES: string;
          URL: string;
          ICON_URL: string;
        };
        Feature: {
          SUPPORT_DRIVES: any;
          NAV_HIDDEN: any;
          MULTISELECT_ENABLED: any;
        };
      };
    };
  }
}

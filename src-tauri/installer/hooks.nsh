; Installer hooks (tauri.conf.json → bundle.windows.nsis.installerHooks).

; Removes the Explorer right-click entries KlikPaper adds when the user turns them
; on (src-tauri/src/shell.rs). Updates keep them: the app rewrites them at launch.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\KlikPaper.merge"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\KlikPaper.compress"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\KlikPaper.images"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\KlikPaper.to-pdf"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\KlikPaper.to-pdf"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.png\shell\KlikPaper.to-pdf"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.webp\shell\KlikPaper.to-pdf"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.gif\shell\KlikPaper.to-pdf"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.bmp\shell\KlikPaper.to-pdf"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.tif\shell\KlikPaper.to-pdf"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.tiff\shell\KlikPaper.to-pdf"
  ${EndIf}
!macroend

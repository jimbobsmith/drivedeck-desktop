!macro customInstall
  ; An unpacked/ZIP/portable executable must not offer an NSIS auto-install.
  FileOpen $0 "$INSTDIR\resources\dd-package-type" w
  FileWrite $0 "nsis"
  FileClose $0
!macroend

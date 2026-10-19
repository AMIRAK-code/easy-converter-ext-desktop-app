; Remove the Explorer right-click entries when Easy Convert is uninstalled.
!macro customUnInstall
  ExecWait '"$INSTDIR\Easy Convert.exe" --unregister'
!macroend

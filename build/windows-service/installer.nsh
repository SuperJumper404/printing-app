!macro customHeader
  !ifndef BUILD_UNINSTALLER
    ; A hidden mandatory section executes before electron-builder's main section.
    ; Unlike page callbacks this also protects silent installations and the final selected path.
    Section "-SmartEat installation security"
      SectionIn RO
      nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\smarteat-service\manage.ps1" -Action PrepareInstall -InstallRoot "$INSTDIR"'
      Pop $0
      Pop $1
      ${If} $0 != 0
        MessageBox MB_ICONSTOP "Le dossier d’installation n’est pas sécurisé ou le service ne peut pas être arrêté. Choisissez Program Files ou un dossier parent protégé créé par un administrateur."
        Abort
      ${EndIf}
    SectionEnd
  !endif
!macroend

!macro customInit
  ; Import before the legacy uninstaller removes the old application directory.
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\smarteat-service"
  File /oname=manage.ps1 "${PROJECT_DIR}\scripts\windows-service\manage.ps1"
  File /oname=ServiceData.psm1 "${PROJECT_DIR}\scripts\windows-service\ServiceData.psm1"
  File /oname=InstallSecurity.psm1 "${PROJECT_DIR}\scripts\windows-service\InstallSecurity.psm1"
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 == ""
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}
  ${If} $0 == ""
    StrCpy $0 "$INSTDIR"
  ${EndIf}
  ; Refuse an unsafe existing installation before its uninstaller could be executed elevated.
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\smarteat-service\manage.ps1" -Action ValidateInstall -InstallRoot "$0"'
  Pop $1
  Pop $2
  ${If} $1 != 0
    MessageBox MB_ICONSTOP "L’ancien dossier SmartEat n’est pas sécurisé. L’installation est arrêtée avant toute exécution de l’ancien programme."
    Abort
  ${EndIf}
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\smarteat-service\manage.ps1" -Action PrepareData -LegacySettingsPath "$0\settings.json"'
  Pop $1
  Pop $2
  ${If} $1 != 0
    MessageBox MB_ICONSTOP "Impossible de préparer les données SmartEat. Les réglages existants sont conservés."
    Abort
  ${EndIf}
!macroend

!macro customInstall
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows-service\manage.ps1" -Action Install -ServiceDir "$INSTDIR\resources\service" -AppExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "L’installation du service SmartEat a échoué. Consultez le journal d’installation dans ProgramData."
    Abort
  ${EndIf}
!macroend

!macro customUnInstall
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows-service\manage.ps1" -Action Uninstall -ServiceDir "$INSTDIR\resources\service"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Impossible de désinstaller le service SmartEat. Les données machine sont conservées."
    Abort
  ${EndIf}
!macroend

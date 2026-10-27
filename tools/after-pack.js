'use strict'

/**
 * electron-builder "afterPack" step (BradysLabs).
 *
 * JR's Mac app isn't signed with an Apple Developer ID. Apple Silicon Macs
 * still refuse to run an app with no signature at all, so this signs it "ad
 * hoc" (no identity, free). Users then only see the usual "unidentified
 * developer" prompt the first time they open it.
 */

const path = require('path')
const { execFileSync } = require('child_process')

exports.default = async function afterPack (context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
  console.log(`  • signed ad hoc  file=${app}`)
}

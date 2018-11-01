import { SoftwareEnvironment } from '@stencila/schema'

import Generator from './Generator'

const PACKAGE_JSON_GENERATED = '.package.json'
const PACKAGE_JSON = 'package.json'

/**
 * A Dockerfile generator for Javascript projects
 */
export default class JavascriptGenerator extends Generator {

  /**
   * The major version of Node.js to use.
   *
   * Defaults to the latest LTS release
   */
  nodeMajorVersion: number

  // Methods that override those in `Generator`

  constructor (environ: SoftwareEnvironment, folder?: string, nodeMajorVersion: number = 10) {
    super(environ, folder)

    this.nodeMajorVersion = nodeMajorVersion
  }

  appliesRuntime (): string {
    return 'Node.js'
  }

  aptKeysCommand (sysVersion: string) {
    return 'curl -sSL https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add -'
  }

  aptRepos (sysVersion: string): Array<string> {
    const baseVersionName = this.baseVersionName(sysVersion)
    return [
      `deb https://deb.nodesource.com/node_${this.nodeMajorVersion}.x ${baseVersionName} main`
    ]
  }

  aptPackages (sysVersion: string): Array<string> {
    return ['nodejs']
  }

  stencilaInstall (sysVersion: string): string | undefined {
    return 'npm install stencila-node@0.28.15'
  }

  installFiles (sysVersion: string): Array<[string, string]> {
    // Use any existing 'package.json'
    if (this.exists(PACKAGE_JSON)) return [[PACKAGE_JSON, PACKAGE_JSON]]

    // Generate a `.package.json` file to copy into image
    const dependencies = this.filterPackages('Javascript').map(pkg => pkg.name)
    const pkgjson = {
      dependencies
    }
    this.write(PACKAGE_JSON_GENERATED, JSON.stringify(pkgjson, null, ' '))
    return [[PACKAGE_JSON_GENERATED, PACKAGE_JSON]]
  }

  installCommand (sysVersion: string): string | undefined {
    return 'npm install package.json'
  }
}

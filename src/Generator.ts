import Doer from './Doer'
import UrlFetcher from './IUrlFetcher'

const VERSION = require('../package').version
const DOCKER_USER = 'guest'

/**
 * Generates a Dockerfile for a `SoftwareEnvironment` instance
 */
export default class Generator extends Doer {
  /**
   * Manually define the image to inherit FROM
   */
  baseImage?: string

  constructor(
    urlFetcher: UrlFetcher,
    folder: string | undefined,
    baseImage?: string
  ) {
    super(urlFetcher, folder)
    this.baseImage = baseImage
  }

  /**
   * Generate a Dockerfile for a `SoftwareEnvironment` instance
   *
   * @param comments Should a comments be added to the Dockerfile?
   * @param stencila Should relevant Stencila language packages be installed in the image?
   */
  generate(comments = true, stencila = false): string {
    let dockerfile = ''

    if (comments) {
      dockerfile += `# Generated by Dockta ${VERSION} at ${new Date().toISOString()}
# To stop Dockta generating this file and start editing it yourself,
# rename it to "Dockerfile".\n`
    }

    if (comments)
      dockerfile += '\n# This tells Docker which base image to use.\n'
    const baseIdentifier = this.baseIdentifier()

    const fromImage =
      this.baseImage !== undefined ? this.baseImage : baseIdentifier

    dockerfile += `FROM ${fromImage}\n`

    if (!this.applies()) return dockerfile

    const aptRepos = this.aptRepos(baseIdentifier)
    const aptKeysCommand = this.aptKeysCommand(baseIdentifier)

    dockerfile += 'USER root\n' // in case the Dockerfile it inherits from drops down to a different user

    if (aptRepos.length || aptKeysCommand) {
      if (comments)
        dockerfile +=
          '\n# This section installs system packages needed to add extra system repositories.'
      dockerfile += `
RUN apt-get update \\
 && DEBIAN_FRONTEND=noninteractive apt-get install -y \\
      apt-transport-https \\
      ca-certificates \\
      curl \\
      software-properties-common
`
    }

    if (comments && (aptKeysCommand || aptRepos.length)) {
      dockerfile +=
        '\n# This section adds system repositories required to install extra system packages.'
    }
    if (aptKeysCommand) dockerfile += `\nRUN ${aptKeysCommand}`
    if (aptRepos.length)
      dockerfile += `\nRUN ${aptRepos
        .map(repo => `apt-add-repository "${repo}"`)
        .join(' \\\n && ')}\n`

    // Set env vars after previous section to improve caching
    const envVars = this.envVars(baseIdentifier)
    if (envVars.length) {
      if (comments)
        dockerfile +=
          '\n# This section sets environment variables within the image.'
      const pairs = envVars.map(
        ([key, value]) => `${key}="${value.replace('"', '\\"')}"`
      )
      dockerfile += `\nENV ${pairs.join(' \\\n    ')}\n`
    }

    const aptPackages: Array<string> = this.aptPackages(baseIdentifier)
    if (aptPackages.length) {
      if (comments) {
        dockerfile += `
# This section installs system packages required for your project
# If you need extra system packages add them here.`
      }
      dockerfile += `
RUN apt-get update \\
 && DEBIAN_FRONTEND=noninteractive apt-get install -y \\
      ${aptPackages.join(' \\\n      ')} \\
 && apt-get autoremove -y \\
 && apt-get clean \\
 && rm -rf /var/lib/apt/lists/*
`
    }

    if (stencila) {
      const stencilaInstall = this.stencilaInstall(baseIdentifier)
      if (stencilaInstall) {
        if (comments)
          dockerfile +=
            '\n# This section runs commands to install Stencila execution hosts.'
        dockerfile += `\nRUN ${stencilaInstall}\n`
      }
    }

    // Once everything that needs root permissions is installed, switch the user to non-root for installing the rest of the packages.
    if (comments) {
      dockerfile += `
# It's good practice to run Docker images as a non-root user.
# This section creates a new user and its home directory as the default working directory.`
    }
    dockerfile += `
RUN id -u ${DOCKER_USER} >/dev/null 2>&1 || useradd --create-home --uid 1001 -s /bin/bash ${DOCKER_USER}
WORKDIR /home/${DOCKER_USER}
`

    const installFiles = this.installFiles(baseIdentifier)
    const installCommand = this.installCommand(baseIdentifier)
    const projectFiles = this.projectFiles(baseIdentifier)
    const runCommand = this.runCommand(baseIdentifier)

    // Add Dockta special comment for managed installation of language packages
    if (installCommand) {
      if (comments)
        dockerfile +=
          '\n# This is a special comment to tell Dockta to manage the build from here on'
      dockerfile += `\n# dockta\n`
    }

    // Copy files needed for installation of language packages
    if (installFiles.length) {
      if (comments)
        dockerfile +=
          '\n# This section copies package requirement files into the image'
      dockerfile +=
        '\n' +
        installFiles.map(([src, dest]) => `COPY ${src} ${dest}`).join('\n') +
        '\n'
    }

    // Run command to install packages
    if (installCommand) {
      if (comments)
        dockerfile +=
          '\n# This section runs commands to install the packages specified in the requirement file/s'
      dockerfile += `\nRUN ${installCommand}\n`
    }

    // Copy files needed to run project
    if (projectFiles.length) {
      if (comments)
        dockerfile +=
          "\n# This section copies your project's files into the image"
      dockerfile +=
        '\n' +
        projectFiles.map(([src, dest]) => `COPY ${src} ${dest}`).join('\n') +
        '\n'
    }

    // Now all installation is finished set the user
    if (comments)
      dockerfile += '\n# This sets the default user when the container is run'
    dockerfile += `\nUSER ${DOCKER_USER}\n`

    // Add any CMD
    if (runCommand) {
      if (comments)
        dockerfile +=
          '\n# This tells Docker the default command to run when the container is started'
      dockerfile += `\nCMD ${runCommand}\n`
    }

    // Write `.Dockerfile` for use by Docker
    this.write('.Dockerfile', dockerfile)

    return dockerfile
  }

  // Methods that are overridden in derived classes

  /**
   * Does this generator apply to the package?
   */
  applies(): boolean {
    return false
  }

  /**
   * Name of the base image
   */
  baseName(): string {
    return 'ubuntu'
  }

  /**
   * Version of the base image
   */
  baseVersion(): string {
    return '19.10'
  }

  /**
   * Get the name of an Ubuntu release
   *
   * @param baseIdentifier The base image name e.g. `ubuntu:18.04`
   */
  baseVersionName(baseIdentifier: string): string {
    const [name, version] = baseIdentifier.split(':')
    const lookup: { [key: string]: string } = {
      '14.04': 'trusty',
      '16.04': 'xenial',
      '18.04': 'bionic',
      '18.10': 'cosmic',
      '19.04': 'disco',
      '19.10': 'eoan',
      '20.04': 'focal'
    }
    return lookup[version]
  }

  /**
   * Generate a base image identifier
   */
  baseIdentifier(): string {
    const joiner = this.baseVersion() === '' ? '' : ':'

    return `${this.baseName()}${joiner}${this.baseVersion()}`
  }

  /**
   * A list of environment variables to set in the image
   * as `name`, `value` pairs
   *
   * @param sysVersion The Ubuntu system version being used
   */
  envVars(sysVersion: string): Array<[string, string]> {
    return []
  }

  /**
   * A Bash command to run to install required apt keys
   *
   * @param sysVersion The Ubuntu system version being used
   */
  aptKeysCommand(sysVersion: string): string | undefined {
    return undefined
  }

  /**
   * A list of any required apt repositories
   *
   * @param sysVersion The Ubuntu system version being used
   */
  aptRepos(sysVersion: string): Array<string> {
    return []
  }

  /**
   * A list of any required apt packages
   *
   * @param sysVersion The Ubuntu system version being used
   */
  aptPackages(sysVersion: string): Array<string> {
    return []
  }

  /**
   * A Bash command to run to install Stencila execution host package/s
   *
   * @param sysVersion The Ubuntu system version being used
   */
  stencilaInstall(sysVersion: string): string | undefined {
    return undefined
  }

  /**
   * A list of files that need to be be copied
   * into the image before running `installCommand`
   *
   * @param sysVersion The Ubuntu system version being used
   * @returns An array of [src, dest] tuples
   */
  installFiles(sysVersion: string): Array<[string, string]> {
    return []
  }

  /**
   * The Bash command to run to install required language packages
   *
   * @param sysVersion The Ubuntu system version being used
   */
  installCommand(sysVersion: string): string | undefined {
    return undefined
  }

  /**
   * The project's files that should be copied across to the image
   *
   * @param sysVersion The Ubuntu system version being used
   * @returns An array of [src, dest] tuples
   */
  projectFiles(sysVersion: string): Array<[string, string]> {
    return []
  }

  /**
   * The default command to run in containers created from this image
   *
   * Usually command will a file with a name `main` and the extension
   * of the generator's language e.g. `.R` if it exists in the folder.
   *
   * @param sysVersion The Ubuntu system version being used
   */
  runCommand(sysVersion: string): string | undefined {
    return undefined
  }
}

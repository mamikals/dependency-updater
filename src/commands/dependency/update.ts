import { readFileSync, writeFileSync } from 'fs';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, AuthInfo, Connection, OrgAuthorization, PackageDirDependency } from '@salesforce/core';
import { PackageVersion, PackageVersionOptions } from '@salesforce/packaging';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('dependency-updater', 'dependency.update');

export type DependencyUpdateResult = PackageUpdates[] | null;
export type PackageUpdates = {
  packageId: string;
  packageAlias: string;
  packageVersion: string;
};
export type PackageDirectories = {
  dependencies: Array<{ package: string; versionNumber: string }>;
};

export type PackageDirectory = {
  packageDirectories: PackageDirectories[];
};

export default class DependencyUpdate extends SfCommand<DependencyUpdateResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly requiresProject = true;

  public static readonly flags = {
    username: Flags.string({
      summary: messages.getMessage('flags.username.summary'),
      char: 'u',
      required: false,
    }),
    'package-id': Flags.string({
      // eslint-disable-next-line sf-plugin/no-missing-messages
      summary: messages.getMessage('flags.package-id.summary'),
      char: 'p',
      required: true,
    }),
  };

  private static getDevHub = async (): Promise<OrgAuthorization | undefined> =>
    AuthInfo.getDevHubAuthInfos().then((a: OrgAuthorization[]) =>
      a.find(
        (mort: OrgAuthorization) =>
          mort.configs != null && mort.configs.length !== 0 && mort.configs.includes('target-dev-hub')
      )
    );

  private static checkIfNewerPackageVersion = (originalVersion: string, versionToCheck: string): boolean => {
    const splitOriginal = originalVersion.split('.');
    const splitCheck = versionToCheck.split('.');
    for (let i = 0; i < splitOriginal.length - 1; i++) {
      if (parseInt(splitCheck[i], 10) > parseInt(splitOriginal[i], 10)) {
        return true;
      }
    }
    return false;
  };

  public async run(): Promise<DependencyUpdateResult> {
    // parse the provided flags
    const { flags } = await this.parse(DependencyUpdate);

    const authOrg = flags.username ?? (await DependencyUpdate.getDevHub())?.username;
    this.log(authOrg);

    if (authOrg === undefined) {
      this.log('Bad');
      return null;
    }

    // Initialize the authorization for the provided username
    const authInfo = await AuthInfo.create({ username: authOrg });

    this.log(`Connecting to ${authOrg}...`);
    // Create a connection to the org
    const connection = await Connection.create({ authInfo });
    this.log(`Connected to ${authOrg} (${authInfo.getFields().orgId}) with API version ${connection.version}`);

    const neededPackages = await this.getPackageAlias(connection, flags['package-id']);
    const currentPackages = this.project.getPackageDirectories()[0]?.dependencies as PackageDirDependency[];

    const filePath = './sfdx-project.json';
    const fileContent = readFileSync(filePath, 'utf8');
    const files = JSON.parse(fileContent) as PackageDirectory;
    const packs = files.packageDirectories[0].dependencies;

    const results: PackageUpdates[] = [];
    for (const currentPackage of currentPackages) {
      const testPackage = neededPackages.find((pack) => pack.packageAlias === currentPackage.package);
      if (!testPackage) continue;
      this.log(
        `Comparing Package ${currentPackage.package}: original is ${currentPackage.versionNumber} and needed is ${testPackage?.packageVersion}`
      );
      if (
        DependencyUpdate.checkIfNewerPackageVersion(currentPackage.versionNumber as string, testPackage?.packageVersion)
      )
        results.push(testPackage);
    }
    this.log('\n');
    for (const ret of results) {
      this.log(`Updating ${ret.packageAlias} to version ${ret.packageVersion}`);
      const replacementText = ret.packageVersion.substring(0, ret.packageVersion.lastIndexOf('.') + 1) + 'LATEST';
      const packer = packs.find((pack) => pack.package === ret.packageAlias);
      if (packer != null) {
        packer.versionNumber = replacementText;
      }
    }

    files.packageDirectories[0].dependencies = packs;
    writeFileSync(filePath, JSON.stringify(files, null, 4));

    return results;
  }

  private getPackageAlias = async (connection: Connection, packageId: string): Promise<PackageUpdates[]> => {
    const returnList: PackageUpdates[] = [];
    const options: PackageVersionOptions = {
      connection,
      project: this.project,
      idOrAlias: packageId,
    };

    const pack = new PackageVersion(options);
    const results = await pack.report(true);

    if (!results.Package2Id || !results.Version) return Promise.reject(null);

    const alias = this.project.getAliasesFromPackageId(results.Package2Id);
    returnList.push({ packageId: results.Package2Id, packageAlias: alias[0], packageVersion: results.Version });

    const dependantPackageIds = results.SubscriberPackageVersion?.Dependencies?.ids;
    if (dependantPackageIds) {
      const promiseMap: Array<Promise<PackageUpdates>> = [];
      dependantPackageIds.forEach((dependantPackage: { subscriberPackageVersionId: string }) =>
        promiseMap.push(
          // eslint-disable-next-line @typescript-eslint/no-misused-promises, no-async-promise-executor
          new Promise(async (resolve, reject) => {
            const newOptions: PackageVersionOptions = {
              connection,
              project: this.project,
              idOrAlias: dependantPackage.subscriberPackageVersionId,
            };
            const newPack = new PackageVersion(newOptions);
            const newResults = await newPack.report(false);
            if (!results.Package2Id || !results.Version) reject(null);
            const newAlias = this.project.getAliasesFromPackageId(newResults.Package2Id);
            resolve({
              packageId: newResults.Package2Id,
              packageAlias: newAlias[0],
              packageVersion: newResults.Version,
            });
          })
        )
      );
      const finalRet = await Promise.all(promiseMap).then((allPackages) => {
        allPackages.forEach((asd) => {
          returnList.push(asd);
        });
        return returnList;
      });
      return finalRet;
    }
    return returnList;
  };
}

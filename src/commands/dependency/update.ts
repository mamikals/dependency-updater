import { readFileSync, writeFileSync } from 'fs';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, AuthInfo, Connection, OrgAuthorization, PackageDirDependency } from '@salesforce/core';
import { PackageVersion, PackageVersionOptions, Package } from '@salesforce/packaging';

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
  packageAliases: { [key: string]: string };
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
    const aliasesToAdd: string[] = [];
    for (const upgrades of neededPackages) {
      const localPackage = packs.find((pack) => pack.package === upgrades.packageAlias);
      if (localPackage) {
        this.log(
          `Comparing Package ${localPackage.package}: original is ${localPackage.versionNumber} and needed is ${upgrades?.packageVersion}`
        );
        if (DependencyUpdate.checkIfNewerPackageVersion(localPackage.versionNumber, upgrades?.packageVersion))
          results.push(upgrades);
      } else {
        this.log(
          `Found dependency for version ${upgrades.packageVersion} of ${upgrades.packageId}, which is not included in the sfdx-project file, adding dependency and alias.`
        );
        results.push(upgrades);
        aliasesToAdd.push(upgrades.packageId);
      }
    }
    this.log('\n');
    if (aliasesToAdd.length > 0) {
      this.log('Fetching all aliases from dev hub');
      const veryPackageList = await Package.list(connection);
      for (const aliases of aliasesToAdd) {
        const aliasFromDevHub = veryPackageList.find((aliasen) => aliasen.Id === aliases);
        if (!aliasFromDevHub) {
          this.log(`Could not find alias for ${aliases}, defaulting to ID`);
          files.packageAliases[aliases] = aliases;
          continue;
        }
        files.packageAliases[aliasFromDevHub.Name] = aliases;
        results.find((packToUpdate) => packToUpdate.packageId === aliases).packageAlias = aliasFromDevHub.Name;
        this.log(`Adding alias for ${aliasFromDevHub.Name}`);
      }
    }
    for (let index = results.length; index > 0; index--) {
      const ret = results[index - 1];
      this.log(`Updating ${ret.packageAlias} to version ${ret.packageVersion}`);
      const replacementText = ret.packageVersion.substring(0, ret.packageVersion.lastIndexOf('.') + 1) + 'LATEST';
      const packer = packs.find((pack) => pack.package === ret.packageAlias);
      if (packer != null) {
        packer.versionNumber = replacementText;
      } else {
        packs.push({ package: ret.packageAlias, versionNumber: ret.packageVersion });
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

    let alias = this.project.getAliasesFromPackageId(results.Package2Id)[0];
    if (!alias) {
      alias = results.Package2Id;
      this.log(`Could not find alias for dependant package ${results.Package2Id}, adding alias based on ID`);
    }
    returnList.push({ packageId: results.Package2Id, packageAlias: alias, packageVersion: results.Version });
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
            let newAlias = this.project.getAliasesFromPackageId(newResults.Package2Id)[0];
            if (!newAlias) {
              newAlias = newResults.Package2Id;
              this.log(`Could not find alias for dependant package ${newResults.Package2Id}, adding alias based on ID`);
            }
            resolve({
              packageId: newResults.Package2Id,
              packageAlias: newAlias,
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

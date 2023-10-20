// when you're ready to use the plugin for real, consider whether your users expect it to work in proxy'd environments.
// If you want to support proxies, you can do something like
// https://github.com/forcedotcom/source-deploy-retrieve/blob/0f6e40c2f5aaddae85c25c9ec099db64537df128/src/registry/coverage.ts#L18
import got from 'got';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('dependency-updater', 'call.external.service');

export type CallExternalServiceResult = {
  text: string;
  number: number;
  found: boolean;
  type: string;
};

export default class CallExternalService extends SfCommand<CallExternalServiceResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public async run(): Promise<CallExternalServiceResult> {
    const result = await got<CallExternalServiceResult>(
      'http://numbersapi.com/random/trivia?json'
    ).json<CallExternalServiceResult>();

    this.log(result.text);

    return result;
  }
}

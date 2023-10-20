import { TestContext } from '@salesforce/core/lib/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import ConnectOrg from '..\\..\\..\\src\\commands\\connect\\org';

describe('connect org', () => {
  const $$ = new TestContext();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;

  beforeEach(() => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
  });

  afterEach(() => {
    $$.restore();
  });

  it('runs hello', async () => {
    await ConnectOrg.run([]);
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('hello world');
  });

  it('runs hello with --json and no provided name', async () => {
    const result = await ConnectOrg.run([]);
    expect(result.path).to.equal(
      'C:\\Users\\M162489\\Documents\\SF\\Plugins\\dependency-updater\\src\\commands\\connect\\org.ts'
    );
  });

  it('runs hello world --name Astro', async () => {
    await ConnectOrg.run(['--name', 'Astro']);
    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('hello Astro');
  });
});

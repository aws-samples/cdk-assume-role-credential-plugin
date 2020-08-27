/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import * as cdk from 'aws-cdk';
import { Configuration } from 'aws-cdk/lib/settings';
import * as logging from 'aws-cdk/lib/logging';
import AWS = require('aws-sdk');
import yargs = require('yargs');

export class AssumeRoleCredentialProviderSource implements cdk.CredentialProviderSource {
  name: string;
  roleNameContextKey: string;
  config: Configuration;

  constructor() {
    this.name = "AssumeRoleCredentialPlugin";
    this.loadContext();
  }

  /**
   * Whether the credential provider is even online
   *
   * Guaranteed to be called before any of the other functions are called.
   */
  public async isAvailable(): Promise<boolean> {
    return true;
  }

  private async canProvideNewStyleSynthesis(accountId: string): Promise<boolean> {
    const roleName = await this.getRoleFromContext(cdk.Mode.ForReading);

    if (roleName) {
      logging.debug(`${this.name} found value for readIamRole ${roleName}. checking if we can obtain credentials`);
      const roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;
      if (!await this.tryAssumeRole(roleArn, accountId)) {
        logging.debug(`${this.name} cannot obtain credentials for role ${roleName}`);
        return false
      }
    } else {
      return false
    }

    logging.debug(`canProvideCredentails for read role: true`);
    return true
  }

  private async canProvideOldStyleSynthesis(accountId: string): Promise<boolean> {
    let canRead = true;
    let canWrite = true;
    const readRoleName = await this.getRoleFromContext(cdk.Mode.ForReading);
    const writeRoleName = await this.getRoleFromContext(cdk.Mode.ForWriting);

    // if the readIamRole is provided in context see if we are able to assume it
    if (readRoleName) {
      logging.debug(`${this.name} found value for readIamRole ${readRoleName}. checking if we can obtain credentials`);
      const roleArn = `arn:aws:iam::${accountId}:role/${readRoleName}`;
      if (!await this.tryAssumeRole(roleArn, accountId)) {
        logging.debug(`${this.name} cannot obtain credentials for role ${readRoleName}`);
        canRead = false;
      }
    } else { canRead = false }

    // if the writeIamRole is provided in context see if we are able to assume it
    if (writeRoleName) {
      logging.debug(`${this.name} found value for writeIamRole ${writeRoleName}. checking if we can obtain credentials`);
      const roleArn = `arn:aws:iam::${accountId}:role/${writeRoleName}`;
      if (!await this.tryAssumeRole(roleArn, accountId)) {
        logging.debug(`${this.name} cannot obtain credentials for role ${writeRoleName}`);
        canWrite = false;
      }
    } else { canWrite = false }

    logging.debug(`canProvideCredentails for read role: ${canRead}`);
    logging.debug(`canProvideCredentails for write role: ${canWrite}`);
    return (canWrite || canRead);
  }

  /**
   * Whether the credential provider can provide credentials for the given account.
   *
   * Since we are not given the mode in this method, the most we can do here is check
   * to see whether we can obtain credentials from at least one of the roles. Because of
   * this, the method could return a false positive in some cases.
   */
  public async canProvideCredentials(accountId: string): Promise<boolean> {
    const style = this.config.context.get('@aws-cdk/core:newStyleStackSynthesis');
    const bootstrap = this.config.context.get('bootstrap');
    if (!bootstrap && style) {
      return this.canProvideNewStyleSynthesis(accountId);
    } else {
      return this.canProvideOldStyleSynthesis(accountId);
    }
  }

  /**
   * Construct a credential provider for the given account and the given access mode
   *
   * Guaranteed to be called only if canProvideCredentails() returned true at some point.
   */
  public async getProvider(accountId: string, mode: cdk.Mode): Promise<AWS.Credentials> {
    const style = this.config.context.get('@aws-cdk/core:newStyleStackSynthesis');
    const bootstrap = this.config.context.get('bootstrap');
    var roleName: string;
    var roleArn: string;
    if (!bootstrap && style) {
      roleName = await this.getRoleFromContext(cdk.Mode.ForReading)
      roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;
    } else {
      roleName = await this.getRoleFromContext(mode);
      roleArn = `arn:aws:iam::${accountId}:role/${roleName}`;
    }

    logging.debug(`${this.name} getting credentials for role ${roleArn} with mode ${mode}`);

    if (style && mode === cdk.Mode.ForWriting && !bootstrap) {
      logging.debug('using newStyleStackSynthesis with mode ForWriting, returning default credentials');
      return this.defaultCredentials()
    } else {
      return AWS.config.credentials = new AWS.ChainableTemporaryCredentials({
        params: {
          RoleArn: roleArn,
          RoleSessionName: `${accountId}-${mode}-session`
        },
        masterCredentials: await this.defaultCredentials(),
      });
    }
  }

  /**
   * Look for a context key based on the mode.
   *
   * A prerequisite to using the plugin is to either create entries in
   * your cdk.context.json file or to pass in the context values from the
   * command line with the --context option.
   */
  private async getRoleFromContext(mode: cdk.Mode): Promise<string> {
    var defaultRoleName: string;
    if (mode === cdk.Mode.ForReading) {
      this.roleNameContextKey = 'assume-role-credentials:readIamRoleName'
      defaultRoleName = 'cdk-readOnlyRole';
    } else {
      this.roleNameContextKey = 'assume-role-credentials:writeIamRoleName'
      defaultRoleName = 'cdk-writeRole';
    }
    const role = this.config.context.get(this.roleNameContextKey);

    return role ?? defaultRoleName
  }

  /**
   * Load context from cdk.context.json as well as the --context command line
   * option. Since we don't have access to the command line arguments from within the
   * cli, we get it from yargs.argv.
   *
   * We also get the verbose option on the cli so that we can match the debug
   * logs
   */
  private async loadContext() {
    yargs
      .option('context', { type: 'array', alias: 'c', nargs: 1, requiresArg: true })
      .option('verbose', { type: 'boolean', alias: 'v', default: false })
      .count('verbose')
      .argv
    this.config = await new Configuration(yargs.argv).load();

    logging.setLogLevel(yargs.argv.verbose as number)
  }

  /**
   * Creating our own CredentialProviderChain.
   *
   * The default CredentialProviderChain will check for
   * EnvironmentCredentials first, but here we're telling
   * it to first check for ECSCredentials (i.e. what CodeBuild uses).
   */
  private defaultCredentials(): Promise<AWS.Credentials> {
    const profile = this.config.settings.get(['profile']);
    const masterCreds = new AWS.CredentialProviderChain([
      function () { return new AWS.ECSCredentials(); },
      function () { return new AWS.SharedIniFileCredentials({ profile: profile }); },
      function () { return new AWS.TokenFileWebIdentityCredentials(); },
      function () { return new AWS.ProcessCredentials({ profile: profile }); },
      function () { return new AWS.EnvironmentCredentials('AWS'); },
      function () { return new AWS.EnvironmentCredentials('AMAZON'); },
      function () { return new AWS.EC2MetadataCredentials(); },
    ]);
    return masterCreds.resolvePromise();
  }

  /**
   * Try to assume the specified role and return the credentials or undefined
   */
  private async tryAssumeRole(roleArn: string, accountId: string): Promise<AWS.STS.Credentials | undefined> {
    
    const region = this.config && this.config.settings && this.config.settings.get(["context"]).region;

    region && AWS.config.update({ region });

    const sts = new AWS.STS({
      credentials: await this.defaultCredentials(),  ...(region && { region }),
    });
 
    let response: AWS.STS.Credentials | undefined;
    try {
      const resp = await sts.assumeRole({
        RoleArn: roleArn,
        RoleSessionName: `${accountId}-session`
      }).promise();
      response = resp.Credentials;
    } catch (e) {
      logging.debug('error assuming role %s', e)
      return undefined
    }
    return response
  }
}

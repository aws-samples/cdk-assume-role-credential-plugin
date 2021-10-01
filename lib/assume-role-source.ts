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
import { Command, Configuration } from 'aws-cdk/lib/settings';
import * as logging from 'aws-cdk/lib/logging';
import AWS = require('aws-sdk');
import yargs = require('yargs');
import {AssumeRoleRequest} from "aws-sdk/clients/sts";

/**
 * Interface defined to pass around external role parameters
 */
interface RoleParam {
  /**
   * Name of the role in the external account
   */
  roleName: string;
  /**
   * External ID used for authorization
   */
  externalId?: string;
}

export class AssumeRoleCredentialProviderSource implements cdk.CredentialProviderSource {
  name: string;
  roleNameContextKey: string;
  config: Configuration;
  loadContextPromise: Promise<void>;

  constructor() {
    this.name = "AssumeRoleCredentialPlugin";
    this.loadContextPromise = this.loadContext();
  }

  /**
   * Whether the credential provider is even online
   *
   * Guaranteed to be called before any of the other functions are called.
   */
  public async isAvailable(): Promise<boolean> {
    await this.loadContextPromise;
    return true;
  }

  private async canProvideNewStyleSynthesis(accountId: string): Promise<boolean> {
    const role = await this.getRoleFromContext(accountId, cdk.Mode.ForReading);

    if (role) {
      logging.debug(`${this.name} found value for readIamRole ${role.roleName}. checking if we can obtain credentials`);
      if (!await this.tryAssumeRole(role, accountId)) {
        logging.debug(`${this.name} cannot obtain credentials for role ${role.roleName}`);
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
    const readRole = await this.getRoleFromContext(accountId, cdk.Mode.ForReading);
    const writeRole = await this.getRoleFromContext(accountId, cdk.Mode.ForWriting);

    // if the readIamRole is provided in context see if we are able to assume it
    if (readRole) {
      logging.debug(`${this.name} found value for readIamRole ${readRole.roleName}. checking if we can obtain credentials`);
      if (!await this.tryAssumeRole(readRole, accountId)) {
        logging.debug(`${this.name} cannot obtain credentials for role ${readRole.roleName}`);
        canRead = false;
      }
    } else { canRead = false }

    // if the writeIamRole is provided in context see if we are able to assume it
    if (writeRole) {
      logging.debug(`${this.name} found value for writeIamRole ${writeRole.roleName}. checking if we can obtain credentials`);
      if (!await this.tryAssumeRole(writeRole, accountId)) {
        logging.debug(`${this.name} cannot obtain credentials for role ${writeRole.roleName}`);
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
    let role: RoleParam;
    if (!bootstrap && style) {
      role = await this.getRoleFromContext(accountId, cdk.Mode.ForReading)
    } else {
      role = await this.getRoleFromContext(accountId, mode);
    }

    logging.debug(`${this.name} getting credentials for role ${role.roleName} with mode ${mode}`);

    if (style && mode === cdk.Mode.ForWriting && !bootstrap) {
      logging.debug('using newStyleStackSynthesis with mode ForWriting, returning default credentials');
      return this.defaultCredentials()
    } else {
      const requestParams = this.getAssumeRoleRequestParams(accountId, role, `${accountId}-${mode}-session`)
      return AWS.config.credentials = new AWS.ChainableTemporaryCredentials({
        params: requestParams,
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
  private async getRoleFromContext(accountId: string, mode: cdk.Mode): Promise<RoleParam> {
    let defaultRoleName: string;
    let externalId: string | undefined;
    if (mode === cdk.Mode.ForReading) {
      this.roleNameContextKey = 'assume-role-credentials:readIamRoleName'
      defaultRoleName = 'cdk-readOnlyRole';
    } else {
      this.roleNameContextKey = 'assume-role-credentials:writeIamRoleName'
      defaultRoleName = 'cdk-writeRole';
    }
    let role = this.config.context.get(this.roleNameContextKey);
    if (typeof role === "string") {
      [role, externalId] = role.split('/')
      role = role.replace("{ACCOUNT_ID}", accountId)
    }

    return { roleName: role ?? defaultRoleName, externalId }
  }

  /**
   * Get AWS region either from CDK context or from command line arguments.
   */
  private getRegion(): string {
    return this.config && this.config.settings && this.config.settings.get(["context"]).region || yargs.argv?.region;
  }

  /**
   * Get AWS partition based on region prefix.
   *
   * Supports three partitions:
   *  - AWS Global (`aws`),
   *  - AWS China (`aws-cn`),
   *  - AWS US Gov (`aws-us-gov`)
   */
  private getPartition(): string {
    const region = this.getRegion();
    const partition = region?.startsWith('cn-') ? 'aws-cn' : (region?.startsWith('us-gov-') ? 'aws-us-gov' : 'aws');
    logging.debug(`Using AWS partition: ${partition} for region ${region}`);
    return partition;
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
    this.config = await new Configuration({
      commandLineArguments: {
        ...yargs.argv,
        _: yargs.argv._ as [Command, ...string[]],
      }
    }).load();

    logging.setLogLevel(yargs.argv.verbose as number)

    // Set environment variables so JS AWS SDK behaves as close as possible to AWS CLI.
    if (process.env.AWS_DEFAULT_PROFILE && !process.env.AWS_PROFILE) {
      process.env.AWS_PROFILE = process.env.AWS_DEFAULT_PROFILE;
    }
    if (process.env.AWS_DEFAULT_REGION && !process.env.AWS_REGION) {
      process.env.AWS_REGION = process.env.AWS_DEFAULT_REGION;
    }
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
  private async tryAssumeRole(role: RoleParam, accountId: string): Promise<AWS.STS.Credentials | undefined> {

    const region = this.getRegion();

    region && AWS.config.update({ region });

    const sts = new AWS.STS({
      credentials: await this.defaultCredentials(), ...(region && { region }),
    });

    let response: AWS.STS.Credentials | undefined;
    try {
      const requestParams = this.getAssumeRoleRequestParams(accountId, role);
      const resp = await sts.assumeRole(requestParams).promise();
      response = resp.Credentials;
    } catch (e) {
      logging.debug('error assuming role %s', e)
      return undefined
    }
    return response
  }


  private getAssumeRoleRequestParams(accountId: string, role: RoleParam, sessionName?: string) {
    const requestParams: AssumeRoleRequest = {
      RoleArn: this.getRoleArn(accountId, role.roleName),
      RoleSessionName: sessionName ?? `${accountId}-session`
    }
    if (typeof role.externalId === "string") {
      requestParams['ExternalId'] = role.externalId
    }
    return requestParams;
  }

  private getRoleArn(accountId: string, roleName: string): string {
    return `arn:${this.getPartition()}:iam::${accountId}:role/${roleName}`;
  }
}

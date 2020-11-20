#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { RequiredResourcesStack } from '../lib/required-resources';

const dev = { account: 'REPLACE_WITH_DEV_ACCOUNT_ID', region: 'us-east-2' }
const prod = { account: 'REPLACE_WITH_PROD_ACCOUNT_ID', region: 'us-east-2' }
const trustedAccount = 'REPLACE_WITH_SHARED_SERVICES_ACCOUNT_ID';

const app = new cdk.App();

new RequiredResourcesStack(app, 'dev', {
  env: dev,
  trustedAccount
});

new RequiredResourcesStack(app, 'prod', {
  env: prod,
  trustedAccount
});

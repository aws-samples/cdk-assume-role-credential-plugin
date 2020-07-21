#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { SampleApp } from '../lib/sample-app';

const app = new cdk.App();

const dev = { account: 'REPLACE_WITH_DEV_ACCOUNT_ID', region: 'us-east-2' }
const prod = { account: 'REPLACE_WITH_PROD_ACCOUNT_ID', region: 'us-east-1' }

new SampleApp(app, 'devSampleApp', { env: dev });
new SampleApp(app, 'prodSampleApp', { env: prod });

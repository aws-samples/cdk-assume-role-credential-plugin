# Plugin Sample App

This is a sample app to show how to use the cdk-assume-role-credential-plugin

## Overview
In this sample app you will use the [cdk-assume-role-credential-plugin](../README.md) to read information from multiple 
AWS Accounts as a part of the synthesis process. For the rest of the walkthrough it will assume the use of three AWS Accounts, 
but you can still follow the walkthrough if you only have access to two. You can use any three accounts, but the role they will
play in the walkthrough are described below:

1. Shared Services Account: This account is where you will run the CDK commands from, and will have access to assume role into the other two AWS Accounts. This is where you would also deploy a pipeline to automate the deployment of your CDK application.
2. Development Application Account: This account is used as the development environment for the CDK application.
3. Production Application Account: This account is used as the production environment for the CDK application.

## Setup
1. Clone this project
```bash
$ git clone https://github.com/aws-samples/cdk-assume-role-credential-plugin.git
```

2. Install the plugin globally
```bash
$ npm install -g git+https://github.com/aws-samples/cdk-assume-role-credential-plugin.git
```

## Create Required Resources

Since this plugin uses pre-provisioned roles in the target AWS Account, you will need to first create those roles. 
We will create two IAM roles with the default names that the plugin looks for. 
The first will be with the name `cdk-readOnlyRole` and will have the ReadOnlyAccess AWS Managed Policy attached. 
The second will be with the name `cdk-writeRole` and will have the AdministratorAccess AWS Managed Policy attached. 
Both roles also are configured to trust the Shared Services account. 

Before starting the following steps, make sure you have the AWS Account IDs for the three accounts and are able to obtain CLI credentials for each AWS Account.

1. Edit the [bin/required-resources.ts](bin/required-resources.ts) file & fill in the AWS Account numbers where indicated. 
```typescript
const dev = { account: 'REPLACE_WITH_DEV_ACCOUNT_ID', region: 'us-east-2' }
const prod = { account: 'REPLACE_WITH_PROD_ACCOUNT_ID', region: 'us-east-2' }
const trustedAccount = 'REPLACE_WITH_SHARED_SERVICES_ACCOUNT_ID';
```

2. Install dependencies:
```bash
$ npm install
```

3. Build the CDK app.
```bash
$ npm run build
```

4. Using CLI credentials for the Dev AWS Account, run cdk deploy to create the resources
```bash
$ cdk deploy dev
```

5. Using CLI credentials for the Prod AWS Account, run cdk deploy to create the resources
```bash
$ cdk deploy prod
```

Now you should have the required roles created in both the Dev and Prod AWS Accounts.

## Synthesize the CDK app
First take a look at the sample app to see what it is comprised of. 
Open the [bin/sample-app.ts](bin/sample-app.ts) file and you will notice that our CDK application is comprised of 
two SampleApp stacks, one deployed to the Dev account, and the other deployed to the Prod account.

1. Edit the [bin/sample-app.ts](bin/sample-app.ts) file & fill in the AWS Account numbers where indicated.

```typescript
const dev = { account: 'REPLACE_WITH_DEV_ACCOUNT_ID', region: 'us-east-2' }
const prod = { account: 'REPLACE_WITH_PROD_ACCOUNT_ID', region: 'us-east-1' }

new SampleApp(app, 'devSampleApp', { env: dev });
new SampleApp(app, 'prodSampleApp', { env: prod });
```

2. Build the CDK app
```bash
$ npm run build
```

3. Using CLI credentials for the Shared Services account try and Synthesize the CDK app
```bash
$ cdk synth –-app "npx ts-node bin/sample-app.ts"
```

You should receive an error message similar to the one below indicating that you do not have credentials for the accounts specified. 
```bash
[Error at /devSampleApp] Need to perform AWS calls for account DEV_ACCOUNT, but the current credentials are for SHARED_SERVICES_ACCOUNT.
[Error at /prodSampleApp] Need to perform AWS calls for account PROD_ACCOUNT, but the current credentials are for SHARED_SERVICES_ACCOUNT.
Found errors
```

4. Run the command again, but this time tell it to use the cdk-assume-role-credential-plugin
```bash
$ cdk synth –-app "npx ts-node bin/sample-app.ts" –-plugin cdk-assume-role-credential-plugin
```

You should see the command succeed!
```bash
Successfully synthesized to /cdk.out
Supply a stack id (devSampleApp, prodSampleApp) to display its template.
```

## Cleaning up
To avoid incurring future charges, delete the resources. 

1. Using CLI credentials for the Dev AWS Account, run cdk destroy to destroy the resources
```bash
$ cdk destroy dev
```

2. Using CLI credentials for the Prod AWS Account, run cdk destroy to destroy the resources
```bash
$ cdk destroy prod
```

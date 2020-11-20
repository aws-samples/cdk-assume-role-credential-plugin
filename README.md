# CDK Assume Role Credential Plugin

This is a CDK credential plugin that assumes a specified role
in the Stack account.

This plugin allows [CDK Pipelines](https://docs.aws.amazon.com/cdk/api/latest/docs/pipelines-readme.html) to perform context lookups.

## When would I use this plugin

There are two main use cases that this plugin addresses.

1. You have a CDK application that deploys stacks to multiple AWS accounts.
2. You have a CDK application that deploys a stack to an AWS account that is different than the current AWS account.

## What it does

This plugin allows the CDK CLI to automatically obtain AWS credentials from a stack's target AWS account.
This means that you can run a single command (i.e. cdk synth) with a set of AWS credentials, and the CLI will
determine the target AWS account for each stack and automatically obtain temporary credentials for the target
AWS account by assuming a role in the account.

For more details on the credential process see the [How does it work](#how-does-it-work) section below.

## Prerequisites

In order to use the plugin in a CDK app you have to first perform a couple prerequisites

### Install the plugin

If you are running the CDK cli from a global install you'll need to install the
plugin globally as well.

```bash
$ npm install -g cdk-assume-role-credential-plugin
```

If you are running from a locally installed version of the CDK cli (i.e. `npm run cdk` or `npx cdk`) you can
install the plugin locally

```bash
$ npm install cdk-assume-role-credential-plugin
```

I would recommend installing the plugin both locally and globally so that the plugin can be used both on a
development machine as well as part of a CI/CD pipeline.

You must then tell the CDK app to use the plugin. This can be done in two ways.

1. cdk.json file

`example cdk.json`
```json
{
  "app": "npx ts-node bin/my-app",
  "plugin": ["cdk-assume-role-credential-plugin"]
}
```

2. via the `--plugin` option on the cli

```bash
$ cdk synth --plugin cdk-assume-role-credential-plugin
```

### Set context values (optional)

This plugin needs to know the name of the IAM roles to assume in the target AWS account. By default
it looks for IAM roles with the names:

- `cdk-readOnlyRole` (for read only operations)
- `cdk-writeRole` (for write operations)

If you would like to provide your own custom values you can do so through setting context values.

The plugin will look for two context keys, which can either be set in the `cdk.context.json`
file or via the `--context` option on the cli.

- `assume-role-credentials:readIamRoleName`: The role name of the role in the stack account that will be assumed to perform read only
activities.
- `assume-role-credentials:writeIamRoleName`: The role name of the role in the stack account that will be assumed to perform write activities.

`example cdk.context.json`
```json
{
  "assume-role-credentials:writeIamRoleName": "writeRole",
  "assume-role-credentials:readIamRoleName": "readRole"
}
```

`example cli`
```bash
$ cdk synth --context assume-role-credentials:writeIamRoleName=writeRole --context assume-role-credentials:readIamRoleName=readRole
```

In addition, the role names can support a placeholder value for the target AWS account ID. This
is especially handy with the new CDK Bootstrap style because the new bootstrap already creates roles
that can be used with this plugin. Below is an example of using the CDK Bootstrap's `deploy-role`.

`example cdk.context.json` 
```json
{
  "context": {
    "assume-role-credentials:readIamRoleName": "cdk-hnb659fds-deploy-role-{ACCOUNT_ID}-us-east-1"
  }
}
```

So the `{ACCOUNT_ID}` placeholder will be replaced with whatever AWS account ID you are attempted to
deploy into. Caution: the AWS region cannot be replaced, so all of your AWS accounts need to have a
common bootstrapped region.

## Using the plugin

Once the [prerequisites](#prerequisites) are completed the CDK CLI will automatically attempt to use the credential plugin
if the default credentials do not work for the stack's target AWS account.

For example, suppose I had a CDK application that deployed 2 stacks, each to a different AWS account.
I am deploying these stacks from a 3rd AWS, so the CDK CLI will automatically attempt to use the plugin
to obtain credentials for the target accounts.

My CDK app
```typescript
const dev  = { account: '2383838383', region: 'us-east-2' };
const prod = { account: '8373873873', region: 'us-east-2' };

new MyAppStack(app, 'dev', { env: dev });
new MyAppStack(app, 'prod', { env: prod });
```

I'll run a single command to synthesize the application.

```bash
$ cdk synth

Successfully synthesized to /myapp/cdk.out
Supply a stack id (dev, prod) to display its template.
```

If you want to see what is happening behind the scenes you can run the command with verbose logging enabled.

*removing logs that aren't related to the plugin*
```bash
$ cdk synth -v

...
AssumeRoleCredentialPlugin found value for readIamRole cdk-readOnlyRole. checking if we can obtain credentials
AssumeRoleCredentialPlugin found value for writeIamRole cdk-writeRole. checking if we can obtain credentials
canProvideCredentails for read role: true
canProvideCredentails for write role: true
Using AssumeRoleCredentialPlugin credentials for account 2383838383
AssumeRoleCredentialPlugin getting credentials for role arn:aws:iam::2383838383:role/cdk-readOnlyRole with mode 0
...

Successfully synthesized to /myapp/cdk.out
Supply a stack id (dev, prod) to display its template.
```

## New style synthesis

If you are using the new style synthesis by setting the context value `@aws-cdk/core:newStyleStackSynthesis`
to `true` then this plugin will work a little differently.

When this setting is `true`, the CLI switches to the new (post-1.46.0) bootstrapping resources
This new bootstrapping stack creates a bucket and several roles in your account, which the CDK CLI
use to deploy to it. In the future, the new bootstrapping resources will become the default, but as of now
they’re still opt-in.

When the new style synthesis is used, the CLI follows these high level steps when deploying your app

1. Load `default` AWS credentials
Then for each stack:
2. Check if credentials match the stack's environment
3. If not, then try to find credentials by using the plugin
Then for each of the next two steps it will get credentials using the plugin, but will not actually use them
4. Publish Assets using bootstrapped `file-publishing-role` (assume this role using `default` credentials)
5. Create & execute CloudFormation Changeset using bootstrapped `deploy-role` & `cfn-exec` roles
(assumes the `deploy-role` using `default` credentials)

This means that the credentials retreived by the plugin are only used to:
1. As a credential check (ensure we can get credentials for target account) (follow this [issue](https://github.com/aws/aws-cdk/issues/9597) for when this will no longer be needed)
2. To perform context lookups (i.e. `ssm.StringParameter.fromLookupValue()`)

The CLI no longer needs the `cdk-writeRole` for anything other than a credential check, so the plugin will treat the `ForWriting` mode
a little differently.

- If `@aws-cdk/core:newStyleStackSynthesis=true` & `mode=ForWriting` & we are not bootstrapping: then
The plugin will simply return the `default` credentials (will not assume a role). This will satisfy the credential check.

- If `@aws-cdk/core:newStyleStackSynthesis=true` & `mode=ForReading`: then
The plugin will use the `readOnlyRole`. Since we don't know whether it is being used to fetch context or simply perform the
credential check, we have to assume that it is fetching context.

- If `@aws-cdk/core:newStyleStackSynthesis=true` & `mode=ForWriting` & `bootstrap=true`: then
The plugin will use the `writeRole`. See the next [section](#new-style-bootstrap) for details on why.

- Otherwise assume this is using the old style syntesis and use both roles as normal.

### New style bootstrap

This plugin can also be used while using the `bootstrap` command while `@aws-cdk/core:newStyleStackSynthesis`
is set to `true`.

For this to work you do need both the `readOnlyRole` and `writeRole` since the bootstrap process does not use
the bootstrap roles (chicken and egg problem).

Using the same example from the [Using the plugin](#using-the-plugin) section above:

```typescript
const dev  = { account: '2383838383', region: 'us-east-2' };
const prod = { account: '8373873873', region: 'us-east-2' };

new MyAppStack(app, 'dev', { env: dev });
new MyAppStack(app, 'prod', { env: prod });
```

You can then bootstrap the target accounts by running the bootstrap command with an additional context
variable `bootstrap=true`. The bootstrap context variable tells the plugin that we are running the bootstrap
command so it should use the `writeRole` to perform write operations (i.e. create & execute changeset).

```bash
$ cdk bootstrap --trust REPLACE_WITH_TRUSTED_ACCOUNT_ID --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess --plugin cdk-assume-role-credential-plugin --context bootstrap=true
```
_note I did not have to specify the environments in the bootstrap command because they are set on the stacks_

If I am using CDK Pipelines and my stacks exist within a [Stage](https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_core.Stage.html) the CLI can't determine the environments so you will need to specify, i.e.:
```bash
$ cdk bootstrap --trust REPLACE_WITH_TRUSTED_ACCOUNT_ID --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess aws://2383838383/us-east-2 aws://8373873873/us-east-2 --plugin cdk-assume-role-credential-plugin --context bootstrap=true
```

### CDK Pipelines

This plugin can also be used to enable context lookups for CDK Pipelines.

When using CDK Pipelines you only need to create the `readOnlyRole` in each
target account. See the [section](#new-style-synthesis) on newStyleStackSynthesis for
more details.

You will also need to update the `synthAction` of your [CdkPipeline](https://docs.aws.amazon.com/cdk/api/latest/docs/pipelines-readme.html) construct
to add an IAM policy allowing the IAM role attached to the CodeBuild project
the ability to AssumeRole into the `cdk-readOnlyRole`.

```typescript
new pipelines.CdkPipeline(this, 'Pipeline', {
  ...
  synthAction: pipelines.SimpleSynthAction.standardNpmSynth({
    ...
    rolePolicyStatements: [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "sts:AssumeRole",
        ],
        resources: [
          "arn:aws:iam::*:role/cdk-readOnlyRole"
        ]
      })
    ]
  })
});
```

For a complete example checkout the [sample application](./cdk-sample-pipelines-app).

## How does it work

The CDK has the concept of [environments](https://docs.aws.amazon.com/cdk/latest/guide/environments.html)
An environment is a combination of the target AWS account and AWS region into which an individual stack is
intended to be deployed.

A CDK app can contain multiple stacks the are deployed to multiple environments. A simple example of this
would be an application that deployed a `dev` stack into a `dev` AWS account and a `prod` stack into a `prod`
AWS account. This would look something like:

```typescript
const dev  = { account: '2383838383', region: 'us-east-2' };
const prod = { account: '8373873873', region: 'us-east-2' };

new MyAppStack(app, 'dev', { env: dev });
new MyAppStack(app, 'prod', { env: prod });
```

When you run a cdk command such as `synth` or `deploy` the cli will need to perform actions against the AWS
account that is defined for the stack. It will attempt to use your default credentials, but what happens if you
need credentials for multiple accounts? This is where credential plugins come into play. The basic flow that the
cli will take when obtaining credentials is:

1. Determine the `environment` for stack
2. Look for credentials that can be used against that environment.
  1. If it can find credentials in the DefaultCredentialChain then it will use those.
  2. If it can't find any, then it will load any credential plugins and attempt to fetch credentials for the
  environment using the credential plugins

Without using a credential plugin you would need to manually obtain credentials for each environment and then
run the cli for that stack. A common script would be something like this:

```bash
#!/bin/bash

ASSUME_ROLE_ARN=$1
SESSION_NAME=$2
STACK=$3

creds=$(mktemp -d)/creds.json
echo "assuming role ${ASSUME_ROLE_ARN} with session-name ${SESSION_NAME}"
aws sts assume-role --role-arn $ASSUME_ROLE_ARN --role-session-name $SESSION_NAME > $creds
export AWS_ACCESS_KEY_ID=$(cat ${creds} | grep "AccessKeyId" | cut -d '"' -f 4)
export AWS_SECRET_ACCESS_KEY=$(cat ${creds} | grep "SecretAccessKey" | cut -d '"' -f 4)
export AWS_SESSION_TOKEN=$(cat ${creds} | grep "SessionToken" | cut -d '"' -f 4)

npm run cdk synth -- $STACK -o dist
```

Which you would then exexute for each stack:
```bash
$ ./assume_role_script.sh arn:aws:iam::2383838383:role/synthRole synth dev
$ ./assume_role_script.sh arn:aws:iam::8373873873:role/synthRole synth prod
```

This can become difficult to maintain, especially across multiple projects and with a CI/CD pipeline. Instead
you can just install a credential plugin and execute a single command and the cli will obtain the appropriate
credentials for each stack.

```bash
$ cdk synth
getting credentials for role arn:aws:iam::2383838383:role/synthRole with mode 0
getting credentials for role arn:aws:iam::8373873873:role/synthRole with mode 0
Successfully synthesized to cdk.out
Supply a stack id (dev, prod) to display its template.
```


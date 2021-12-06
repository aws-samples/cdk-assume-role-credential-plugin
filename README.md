# THIS PROJECT IS NO LONGER MAINTAINED

## CDK Assume Role Credential Plugin


Now that CDK V2 is [GA](https://aws.amazon.com/about-aws/whats-new/2021/12/aws-cloud-development-kit-cdk-generally-available/)
I no longer recommend using this plugin. This plugin was originally created to fill a feature
gap in the CDK where you could not assume roles into a separate AWS account. This feature
was added to the CDK CLI when using the context flag `@aws-cdk/core:newStyleStackSythesis` which as of
V2 has been made the default value.

Now by default when you bootstrap an AWS account it will create a set of IAM roles for you, which
the CDK will assume when performing actions in that account.

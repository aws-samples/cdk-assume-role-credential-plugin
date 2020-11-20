import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';

export interface RequiredResourcesStackProps extends cdk.StackProps {
  /**
   * The AWS Account ID to add to the IAM Role trust policy.
   * Any role from this AWS Account will be able to assume the
   * two roles created
   */
  trustedAccount: string;
}

export class RequiredResourcesStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: RequiredResourcesStackProps) {
    super(scope, id, props);

    // the role to assume when the CDK is in read mode, i.e. synth
    // allow roles from the trusted account to assume this role
    const readRole = new iam.Role(this, 'ReadRole', {
      assumedBy: new iam.AccountPrincipal(props.trustedAccount),
      roleName: 'cdk-readOnlyRole'
    });

    // Attach the ReadOnlyAccess policy to this role. You could use a more restrictive policy
    // if you only wanted read access to specific resources
    readRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('ReadOnlyAccess'));
  }
}

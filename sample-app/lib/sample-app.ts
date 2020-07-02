import * as cdk from '@aws-cdk/core';
import * as ssm from '@aws-cdk/aws-ssm';

export class SampleApp extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // just doing a simple ssm parameter lookup to have the CDK read from the account
    const param = ssm.StringParameter.valueFromLookup(this, '/aws/service/ecs/optimized-ami/amazon-linux/recommended')

    new cdk.CfnOutput(this, 'Param', {
      value: param
    });
  }
}

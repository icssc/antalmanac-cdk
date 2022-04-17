import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { Distribution, OriginAccessIdentity, AllowedMethods, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront'
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins'
import { PolicyStatement, CanonicalUserPrincipal } from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3Deployment from 'aws-cdk-lib/aws-s3-deployment'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as targets from 'aws-cdk-lib/aws-route53-targets'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'

interface BackendProps extends StackProps {
    stage: string
}

const transformUrl = (url: string, props: BackendProps): string => {
    return (props.stage === 'dev' ? 'dev.' : '') + url
}

export default class BackendStack extends Stack {
    constructor(scope: Construct, id: string, props?: BackendProps) {
        super(scope, id, props)

        const websiteBucket = new s3.Bucket(
            this,
            `antalmanac-website-bucket-${props.stage}`,
            {
                bucketName: transformUrl('antalmanac.com', props),
                removalPolicy: RemovalPolicy.DESTROY,
                autoDeleteObjects: true,
            },
        )

        const cloudfrontOAI = new OriginAccessIdentity(this, 'cloudfront-OAI');
        
        websiteBucket.addToResourcePolicy(new PolicyStatement({
            actions: ['s3:GetObject'],
            resources: [websiteBucket.arnForObjects('*')],
            principals: [new CanonicalUserPrincipal(cloudfrontOAI.cloudFrontOriginAccessIdentityS3CanonicalUserId)]
          }));

        const sessionStoreDB = new dynamodb.Table(this, `antalmanac-session-store-ddb-${props.stage}`, {
            partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING},
            timeToLiveAttribute: 'expires'
        })

        const api = new lambda.Function(
            this,
            `antalmanac-api-${props.stage}-lambda`,
            {
                runtime: lambda.Runtime.NODEJS_14_X,
                code: lambda.Code.fromAsset('functions/antalmanac-backend'),
                handler: 'lambda.handler',
                environment: {
                    AA_MONGODB_URI:
                        props.stage === 'prod'
                            ? process.env.MONGODB_URI_PROD
                            : process.env.MONGODB_URI_DEV,
                    CORS_ENABLED: (props.stage === 'prod').toString(),
                    GOOGLE_CLIENT: process.env.GOOGLE_CLIENT,
                    GOOGLE_SECRET: process.env.GOOGLE_SECRET,
                    SESSION_SECRET: process.env.SESSION_SECRET,
                    SESSION_DDB_NAME: sessionStoreDB.tableName
                },
            },
        )
        
        sessionStoreDB.grantFullAccess(api)

        const zone = route53.HostedZone.fromHostedZoneAttributes(
            this,
            `antalmanac-DNS-${props.stage}`,
            {
                zoneName: 'antalmanac.com',
                hostedZoneId: process.env.HOSTED_ZONE_ID,
            },
        )

        const cert = acm.Certificate.fromCertificateArn(this,`api-gateway-cert-${props.stage}`, process.env.CERTIFICATE_ARN)
        const apiGateway = new apigateway.LambdaRestApi(
            this,
            `antalmanac-api-gateway-${props.stage}`,
            {
                handler: api,
                domainName: {
                    domainName: transformUrl('api.antalmanac.com', props),
                    certificate: cert,
                    endpointType: apigateway.EndpointType.EDGE,
                },
            },
        )

        const distribution = new Distribution(this, 'Distribution', {
            certificate: cert,
            defaultRootObject: 'index.html',
            domainNames: ['dev.antalmanac.com'],
            defaultBehavior: {
                origin: new S3Origin(websiteBucket, {originAccessIdentity: cloudfrontOAI}),
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS
            },
        })

        new route53.ARecord(
            this,
            `antalmanac-backend-a-record-${props.stage}`,
            {
                zone: zone,
                recordName: transformUrl('api', props),
                target: route53.RecordTarget.fromAlias(
                    new targets.ApiGateway(apiGateway),
                ),
            },
        )
        
        new route53.ARecord(
            this,
            `antalmanac-frontend-a-record-${props.stage}`,
            {
                zone: zone,
                // recordName: transformUrl('api', props),
                recordName: 'dev',
                target: route53.RecordTarget.fromAlias(
                    new targets.CloudFrontTarget(distribution),
                ),
            },
        )

        new s3Deployment.BucketDeployment(this, 'deployAntalmanacToBucket', {
            sources: [
                s3Deployment.Source.asset('./functions/AntAlmanac/build'),
            ],
            destinationBucket: websiteBucket,
            distribution: distribution,
            distributionPaths: ['/*']
        })
    }
}

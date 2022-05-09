import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import { Distribution, OriginAccessIdentity, AllowedMethods, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront'
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins'
import { PolicyStatement, CanonicalUserPrincipal } from 'aws-cdk-lib/aws-iam'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3Deployment from 'aws-cdk-lib/aws-s3-deployment'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as targets from 'aws-cdk-lib/aws-route53-targets'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'

interface WebsiteProps extends StackProps {
    stage: string
}

export default class WebsiteStack extends Stack {
    constructor(scope: Construct, id: string, props?: WebsiteProps) {
        super(scope, id, props)

        const websiteBucket = new s3.Bucket(
            this,
            `antalmanac-website-bucket-${props.stage}`,
            {
                bucketName: 'dev.antalmanac.com',
                removalPolicy: RemovalPolicy.DESTROY,
                autoDeleteObjects: true,
            },
        )

        const cloudfrontOAI = new OriginAccessIdentity(this, 'cloudfront-OAI');
        
        websiteBucket.addToResourcePolicy(new PolicyStatement({
            actions: ['s3:GetObject'],
            resources: [websiteBucket.arnForObjects('*')],
            principals: [new CanonicalUserPrincipal(cloudfrontOAI.cloudFrontOriginAccessIdentityS3CanonicalUserId)]
        }))

        const zone = route53.HostedZone.fromHostedZoneAttributes(
            this,
            `antalmanac-DNS-${props.stage}`,
            {
                zoneName: 'antalmanac.com',
                hostedZoneId: process.env.HOSTED_ZONE_ID,
            },
        )

        const cert = acm.Certificate.fromCertificateArn(this,`api-gateway-cert-${props.stage}`, process.env.CERTIFICATE_ARN)

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
            `antalmanac-frontend-a-record-${props.stage}`,
            {
                zone: zone,
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

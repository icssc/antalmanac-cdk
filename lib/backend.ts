import { Stack, StackProps } from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
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
                    ISPROD: (props.stage === 'prod').toString(),
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
    }
}

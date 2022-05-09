import 'source-map-support/register'
import { App, Environment } from 'aws-cdk-lib'
// import CognitoStack from './cognito'
import BackendStack from './backend'
// import CloudwatchStack from './cloudwatch'
import 'dotenv/config'
import WebsiteStack from './website'

const app = new App({ autoSynth: true })
const account = process.env['ACCOUNT_ID']

const stages = {
    dev: 'us-east-1',
    // prod: 'us-west-1'
}

for (const [stage, region] of Object.entries(stages)) {
    const env: Environment = { region: region, account: account }

    // new CognitoStack(app, `${stage}-${region}-Cognito`, { env, stage })
    new BackendStack(app, `${stage}-${region}-Backend`, { env, stage })
    if (stage === 'dev'){
        new WebsiteStack(app, `${stage}-${region}-Website`, { env, stage })
    }
    // new CloudwatchStack(app, `${stage}-${region}-Cloudwatch`, { env, stage })
}
    
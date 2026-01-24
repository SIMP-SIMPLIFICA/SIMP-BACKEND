import { config } from 'dotenv'
import * as dotenvExpand from 'dotenv-expand'

const myEnv = config()
dotenvExpand.expand(myEnv)
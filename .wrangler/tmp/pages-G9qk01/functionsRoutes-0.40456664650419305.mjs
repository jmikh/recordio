import { onRequest as __api_v2_m___catchall___ts_onRequest } from "/Users/johnmikhail/Projects/recordio-all/recordio/functions/api/v2/m/[[catchall]].ts"
import { onRequest as __api_v2_l_index_ts_onRequest } from "/Users/johnmikhail/Projects/recordio-all/recordio/functions/api/v2/l/index.ts"
import { onRequestGet as __video__slug__ts_onRequestGet } from "/Users/johnmikhail/Projects/recordio-all/recordio/functions/video/[slug].ts"
import { onRequest as __mp___catchall___ts_onRequest } from "/Users/johnmikhail/Projects/recordio-all/recordio/functions/mp/[[catchall]].ts"
import { onRequest as __sentry_index_ts_onRequest } from "/Users/johnmikhail/Projects/recordio-all/recordio/functions/sentry/index.ts"

export const routes = [
    {
      routePath: "/api/v2/m/:catchall*",
      mountPath: "/api/v2/m",
      method: "",
      middlewares: [],
      modules: [__api_v2_m___catchall___ts_onRequest],
    },
  {
      routePath: "/api/v2/l",
      mountPath: "/api/v2/l",
      method: "",
      middlewares: [],
      modules: [__api_v2_l_index_ts_onRequest],
    },
  {
      routePath: "/video/:slug",
      mountPath: "/video",
      method: "GET",
      middlewares: [],
      modules: [__video__slug__ts_onRequestGet],
    },
  {
      routePath: "/mp/:catchall*",
      mountPath: "/mp",
      method: "",
      middlewares: [],
      modules: [__mp___catchall___ts_onRequest],
    },
  {
      routePath: "/sentry",
      mountPath: "/sentry",
      method: "",
      middlewares: [],
      modules: [__sentry_index_ts_onRequest],
    },
  ]
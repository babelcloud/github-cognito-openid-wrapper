const logger = require('./logger');
const openid = require('../openid');
const { GITHUB_ORGS, GITHUB_TEAMS } = require('../config');

module.exports = (respond) => ({
  authorize: (client_id, scope, state, response_type) => {
    const authorizeUrl = openid.getAuthorizeUrl(
      client_id,
      scope,
      state,
      response_type
    );
    logger.info('Redirecting to authorizeUrl');
    logger.debug('Authorize Url is: %s', authorizeUrl, {});
    respond.redirect(authorizeUrl);
  },
  userinfo: (tokenPromise) => {
    tokenPromise
      .then(async (token) => ({ token, userInfo: await openid.getUserInfo(token) }))
      .then(async ({ token, userInfo }) => {
        logger.debug('Resolved user infos:', userInfo, {});
        if (GITHUB_ORGS.trim() === '') {
          logger.info('No orgs configured, skipping membership check');
          respond.success(userInfo);
          return;
        }
        const orgs = GITHUB_ORGS.split(',');
        const orgMemberships = (await Promise.all(orgs.map(org =>
          openid.verifyOrgMembership(token, org, userInfo.preferred_username)
            .then(() => org)
            .catch(error => {
              logger.info('Membership check failed for org %s: %s', org, error.message || error);
              return null;
            })
        ))).filter(Boolean);

        if (orgMemberships === 0) {
          respond.error('User has no membership in provided organisations');
          return;
        }

        if (GITHUB_TEAMS.trim() === '') {
          logger.info('User have membership in %s', orgMemberships.join(', '));
          respond.success(userInfo);
          return;
        }

        logger.info('Test: user must have membership in one of %s', GITHUB_TEAMS.split(','));
        const username = userInfo.preferred_username;

        // Teams are scoped by their owning organisation
        // So we expect to find them of the format: `org:team`, or `*:team` for wildcards.
        // e.g. org1:foo,org2:bar,org2:baz,*:bing
        // foo and bing map to org 1
        // bar, baz and bing map to org 2
        const teams = GITHUB_TEAMS
          .split(',')
          .map((team) => team.trim())
          .filter((team) =>
            orgMemberships.includes(team.split(':')[0])
            || team.split(':')[0] === '*'
          );

        // We'll use a loop even though eslint suggests not using awaits in loops.
        // This will limit unnecessary API calls to GitHub and mean we have to worry less
        // about rate limiting. It also means we can stop after we find the first group
        // membership.
        for (let i = 0; i < teams.length; i += 1) {

          const teamOrg = teams[i].split(':')[0] === '*' ? orgMemberships[0] : teams[i].split(':')[0];
          const team = teams[i].split(':')[1];

          try {
            // eslint-disable-next-line no-await-in-loop
            const confirmation = await openid.verifyTeamMembership(token, teamOrg, team, username);
            if (confirmation) {
              logger.info('Success: %s has membership in %s (%s)', username, team, teamOrg);
              respond.success(userInfo);
              return
            }
          } catch (error) {
            logger.info('User has no membership in %s', teams[i]);
          }
        }

        respond.error('User does not have membership in at least one of the required teams.');

      })
      .catch((error) => {
        logger.error(
          'Failed to provide user info: %s',
          error.message || error,
          {}
        );
        respond.error(error);
      });
  },
  token: (code, state, host) => {
    if (code) {
      openid
        .getTokens(code, state, host)
        .then((tokens) => {
          logger.debug(
            'Token for (%s, %s, %s) provided',
            code,
            state,
            host,
            {}
          );
          respond.success(tokens);
        })
        .catch((error) => {
          logger.error(
            'Token for (%s, %s, %s) failed: %s',
            code,
            state,
            host,
            error.message || error,
            {}
          );
          respond.error(error);
        });
    } else {
      const error = new Error('No code supplied');
      logger.error(
        'Token for (%s, %s, %s) failed: %s',
        code,
        state,
        host,
        error.message || error,
        {}
      );
      respond.error(error);
    }
  },
  jwks: () => {
    const jwks = openid.getJwks();
    logger.info('Providing access to JWKS: %j', jwks, {});
    respond.success(jwks);
  },
  openIdConfiguration: (host) => {
    const config = openid.getConfigFor(host);
    logger.info('Providing configuration for %s: %j', host, config, {});
    respond.success(config);
  },
});

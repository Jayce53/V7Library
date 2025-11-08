/**
 * Project-specific configuration values overriding the shared defaults.
 */
import ConfigurationBase from "#v7/ConfigurationBase.js";

/**
 * Project specific configuration values.
 *
 * Populate the static fields below with the credentials and paths appropriate
 * for your environment. Keeping this as code rather than JSON allows inline
 * documentation and conditional logic if required.
 */
export default class Configuration extends ConfigurationBase {
  static override readonly DB_HOST = "localhost";
  static override readonly DB_PORT = 3306;
  static override readonly DB_USER = "fooderific";
  static override readonly DB_PASSWORD = "";
  static override readonly DB_NAME = "fooderific";
  static override readonly DB_CONNECTION_LIMIT = 20;

  static override readonly CACHE_DOMAIN = "fooderific.com";

  static override readonly MEMCACHED_SERVERS = Object.freeze([
    {host: "127.0.0.1", port: 11211},
  ]);

  static override readonly LOGGER_ADDRESS = null;
  static override readonly LOGGER_PORT = null;
}

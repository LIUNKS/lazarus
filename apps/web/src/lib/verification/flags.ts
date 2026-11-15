// The Execution_Flag (Requirement 4 criterion 1). Pure module: it reads no environment variable, no database
// value, and no request value.

/**
 * Live execution of user-imported code. Shipped as false.
 * Flip only in a reviewed change, after the hardening in the Threat_Model of
 * 07-sandboxed-execution is judged adequate for the intended audience.
 */
export const USER_EXECUTION_ENABLED = false;

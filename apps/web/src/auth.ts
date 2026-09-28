export type WorkbenchAuthOptions = {
  emailAndPassword: {
    enabled: true;
    disableSignUp: true;
  };
};

export function createWorkbenchAuthOptions(): WorkbenchAuthOptions {
  throw new Error("auth options not implemented");
}

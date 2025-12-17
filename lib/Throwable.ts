export default class Throwable extends Error {
  public hint?: string;
  constructor(name: string, messsage: string, hint?: any) {
    super(messsage);
    this.name = name;

    this.hint = hint;
    if (!hint || (typeof hint === 'string' && !hint.trim())) delete this.hint;
  }
}

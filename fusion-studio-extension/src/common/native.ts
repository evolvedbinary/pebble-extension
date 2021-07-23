export const nativePath = '/services/native';

export const NativeServer = Symbol('NativeServer');

export interface NativeServer {
    upload(server: string, username: string, password: string, parent: string, files: string[]): Promise<number>;
    upload(server: string, username: string, password: string, parent: string, files: string): Promise<number>;
}

import { injectable } from 'inversify';
import { readFile, lstatSync, readdirSync } from 'fs';
import { join } from 'path';
import { FSDocument } from '../classes/item';
import { createError, FSError } from '../classes/error';
import { NativeServer } from '../common/native';
import * as FormData from 'form-data';
import fetch from 'node-fetch';

type FileDefinition = [string, Buffer];

export class FSFiles implements Iterable<FileDefinition> {
  constructor(private files: FileDefinition[]) {}
  [Symbol.iterator]() {
    let currentIndex = 0;
    return {
      next: () => {
        const done = currentIndex === this.files.length - 1 || undefined;
        return {
          value: this.files[currentIndex++],
          done,
        };
      }
    };
  }
}
@injectable()
export class NativeServerImpl implements NativeServer {

  upload(server: string, username: string, password: string, parent: string, files: string[]): Promise<number>;
  upload(server: string, username: string, password: string, parent: string, files: string): Promise<number>;
  upload(server: string, username: string, password: string, parent: string, files: string | string[]): Promise<number> {
    return new Promise(async (resolve, reject) => {
      console.log('server:', server);
      console.log('username:', username);
      console.log('password:', password);
      console.log('files:', files);
      if (typeof files === 'string') {
        files = [files];
      }
      const root = this.getRoot(files);
      console.log('roots:', root);
      const docs = await this.listFiles(files, root.length);
      console.log('docs:', docs);
      try {
        await this.doUpload(server, username, password, parent, docs);
        console.log('UPLOADED');
        resolve(files.length);
      } catch (e) {
        console.log('ERROR UPLOADING');
        console.dir(e);
        reject(e);
      }
    });
  }
  public getRoot(files: string[]): string {
    const paths = files.map(file => {
      const path = file.split('/');
      path.pop();
      return path;
    });
    const rootPath = paths.reduce<string[]>((result, path) => {
        if (result.length > path.length) {
          result = result.slice(0, path.length);
        }
        const pos = result.findIndex((name, i) => name !== path[i]);
        return pos < 0 ? result : result.slice(0, pos);
      }, paths.shift() || []);
    return rootPath.join('/') + '/';
  }
  public async listFiles(list: string[], root: number): Promise<FileDefinition[]> {
    const files: FileDefinition[] = [];
    await Promise.all(list.map(entry => this.listFile(entry, files, root)));
    return files;
  }
  public async getFile(item: string): Promise<Buffer> {
    return new Promise<any>((resolve, reject) => readFile(item, (err, data) => err ? reject(err) : resolve(data)));
  }
  public async listFile(item: string, files: FileDefinition[], root: number): Promise<any> {
    if (lstatSync(item).isDirectory()) {
      await Promise.all(readdirSync(item)
        .filter(file => file !== '.' && file !== '..')
        .map(file => this.listFile(join(item, file), files, root)));
    } else {
      let path = item.substr(root);
      if (path[0] === '/') {
        path = path.substr(1);
      }
      files.push([path, await this.getFile(item)]);
    }
  }
  async doUpload(server: string, username: string, password: string, parent: string, files: FileDefinition[]): Promise<FSDocument[]> {
    try {
      const headers: any = {};
      headers.Authorization = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
      const body = new FormData();
      files.forEach(([filepath, buffer]) => body.append(filepath, buffer, { filepath }));
      const result = await fetch(server + '/exist/restxq/fusiondb/document?uri=' + parent, {
        headers,
        method: 'PUT',
        body,
      });
      switch (result.status) {
        case 201: return Promise.resolve([]); // all((await result.json() as any[]).map(doc => readItem(doc, connection ? connection.username : '') as FSDocument));
        case 401: throw createError(FSError.permissionDenied, result);
        default: throw createError(FSError.unknown, result);
      }
    } catch (error) {
      throw createError(FSError.unknown, error);
    }
    throw createError(FSError.unknown, 'error');
  }
}

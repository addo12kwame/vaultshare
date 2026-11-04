import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID,randomBytes} from 'node:crypto';
import {cloudDemo} from '../server/cloud-demo.js';
import {createApp} from '../server/app.js';
const enabled=process.env.RUN_CLOUD_TESTS==='1';
if(enabled)process.loadEnvFile('.env.local');
const origin='https://demo.example.test';
process.env.APP_ORIGIN=origin;
test('hosted files persist privately across instances; share links work across browsers and revoke', {skip:!enabled},async()=>{
 const apps=[cloudDemo(o=>createApp('',o,true)),cloudDemo(o=>createApp('',o,true))];
 const password=randomBytes(20).toString('hex');
 const post=(url:string,cookie='',body={},app=apps[0])=>request(app).post(url).set('Origin',origin).set('Cookie',cookie).send(body);
 try{
  const a=await post('/api/auth/register','',{email:`alice-${randomUUID()}@example.test`,password}).expect(200);
  const b=await post('/api/auth/register','',{email:`bob-${randomUUID()}@example.test`,password}).expect(200);
  const alice=a.headers['set-cookie'][0].split(';')[0],bob=b.headers['set-cookie'][0].split(';')[0];
  const bytes=Buffer.from('Original synthetic VaultShare cloud test file.');
  const uploaded=await request(apps[0]).post('/api/files').set('Origin',origin).set('Cookie',alice).attach('file',bytes,'sample.txt').expect(201);
  const id=uploaded.body.id;
  await request(apps[1]).get(`/api/files/${id}/download`).set('Cookie',bob).expect(404);
  const own=await request(apps[1]).get(`/api/files/${id}/download`).set('Cookie',alice).expect(200);
  assert.deepEqual(own.body,bytes);
  const share=await post(`/api/files/${id}/shares`,alice,{hours:1}).expect(201);
  const token=new URL(share.body.url).pathname.split('/').pop();
  const guest=await request(apps[1]).get(`/api/public/${token}/download`).expect(200);
  assert.deepEqual(guest.body,bytes);
  await request(apps[0]).delete(`/api/shares/${share.body.id}`).set("Origin",origin).set("Cookie",alice).expect(200);
  await request(apps[1]).get(`/api/public/${token}/download`).expect(404);
  await request(apps[0]).delete(`/api/files/${id}`).set('Origin',origin).set('Cookie',alice).expect(200);
 }finally{await Promise.all(apps.map(a=>a.locals.closeDemoStore()));}
});

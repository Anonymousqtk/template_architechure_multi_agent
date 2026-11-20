import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Units } from './Units';
import { request } from './api';
vi.mock('./api',async original=>({...await original<typeof import('./api')>(),request:vi.fn()}));
const mock=vi.mocked(request);
const unit={id:'unit',name:'Company',code:'CO',description:null,isActive:true,role:'ADMIN',current:false,canSelect:true,canEdit:true};
afterEach(()=>{cleanup();mock.mockReset();vi.restoreAllMocks();});

it('offers authorized selection and reloads the server profile after rotating the session',async()=>{
  const profile={organization:{id:'unit',role:'ADMIN'}};
  mock.mockImplementation(async path=>path==='/api/units'?{items:[unit],canCreate:false,canArchive:false}:path==='/api/auth/me'?profile:{});
  const selected=vi.fn();render(<Units onSelected={selected}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Chọn đơn vị'}));
  await waitFor(()=>expect(selected).toHaveBeenCalledWith(profile));
  expect(mock).toHaveBeenCalledWith('/api/units/unit/select',{},'POST');
  expect(screen.queryByRole('button',{name:'Tạo đơn vị'})).not.toBeInTheDocument();
});

it('lets a system administrator nominate the initial Admin when creating a company',async()=>{
  mock.mockImplementation(async path=>path==='/api/units'?{items:[],canCreate:true,canArchive:true}:{});
  render(<Units onSelected={()=>{}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Tạo đơn vị'}));
  fireEvent.change(screen.getByLabelText('Tên đơn vị'),{target:{value:'New company'}});
  fireEvent.change(screen.getByLabelText('Mã đơn vị'),{target:{value:'new'}});
  fireEvent.change(screen.getByLabelText('Email Admin ban đầu'),{target:{value:'admin@example.test'}});
  fireEvent.submit(screen.getByRole('form',{name:'Tạo đơn vị'}));
  await waitFor(()=>expect(mock).toHaveBeenCalledWith('/api/units',{name:'New company',code:'NEW',description:null,adminEmail:'admin@example.test'},'POST'));
});

it('archives only after confirmation and restores archived companies',async()=>{
  vi.spyOn(window,'confirm').mockReturnValue(true);
  mock.mockImplementation(async path=>path==='/api/units'?{items:[unit,{...unit,id:'archived',name:'Archived',isActive:false,canSelect:false}],canCreate:true,canArchive:true}:{});
  render(<Units onSelected={()=>{}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Xóa / lưu trữ'}));
  await waitFor(()=>expect(mock).toHaveBeenCalledWith('/api/units/unit',{},'DELETE'));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Xóa / lưu trữ'})).toBeEnabled());
  fireEvent.click(screen.getByLabelText('Hiện đơn vị đã lưu trữ'));
  fireEvent.click(screen.getByRole('button',{name:'Khôi phục'}));
  await waitFor(()=>expect(mock).toHaveBeenCalledWith('/api/units/archived',{name:'Archived',code:'CO',description:null,isActive:true},'PATCH'));
});
